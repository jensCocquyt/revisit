# Step 1: save and search

## Goal

Save links, text and screenshots from a web page, then find them again by meaning or by exact text, in any language. Runs on your laptop (Docker Compose). Done when the eval meets its bar and it is usable day to day locally.

## Out of scope

Deploy and login (step 2), browser extension, "more like this", grouping, tags, summaries, deadlines, multiple users, object storage, a vector index, re-fetching pages that changed, PDFs.

## Decisions

- **Stack:** TypeScript only. `server/` (Hono on Node 24) and `web/` (React + Vite), each its own package, no workspaces. In production the server serves the built web app as one container. Biome for lint and format. Plain SQL through `pg`, request validation with Zod, plain SQL migrations applied at startup with postgrator.
- **Database:** Postgres 18 with pgvector and pg_trgm, in Compose locally.
- **Embeddings:** Cohere Embed v4 (`cohere.embed-v4:0`) on Bedrock in eu-west-1, 1024 dimensions; passages embedded as `search_document`, queries as `search_query`. Called through `@aws-sdk/client-bedrock-runtime`.
- **Screenshot reading:** Claude Haiku 5.5 through the `eu.anthropic.claude-haiku-5-5` inference profile, model id from config. Called through the Anthropic Bedrock SDK.
- **Credentials:** local AWS profile from the environment; nothing in the repo.
- **Untrusted input:** page text and screenshot content are data for the model, never instructions.

## Data

- `items`: id, kind (`link` | `text` | `screenshot`), url, title, note, body, image bytes + media type, status (`pending` | `processing` | `ready` | `failed`), error, created_at, processed_at. Saving a link that already exists (fragment and `utm_*` stripped) returns the existing item.
- `passages`: item_id, position, text, generated `simple` tsvector, embedding `vector(1024)`. Passage 0 is title + note + URL, so those are searchable for every item. GIN indexes on the tsvector and on trigrams of the text; no vector index until search is measurably slow.

## Processing

- Saving inserts the item as `pending` and returns it immediately.
- One loop in the server process takes the oldest `pending` item, marks it `processing`, does the slow work outside any transaction, then writes passages and `ready` in one transaction. Errors set `failed` with the message; the UI offers retry. On startup, `processing` items go back to `pending`.
- **Text:** body is the text; first line becomes the title.
- **Link:** fetch http(s) only, with a 10 s timeout and a 5 MB cap; extract the article with Mozilla Readability. Addresses are checked at connect time, through a custom `lookup` on the HTTP agent that rejects private, loopback and link-local results, so redirects and DNS rebinding cannot slip past a separate earlier lookup. Unit tests cover IPv4-mapped IPv6 (`::ffff:10.0.0.1`) and non-decimal IPv4 forms. A page that cannot be read still becomes `ready`, searchable by URL, title and note, with the reason in `error`.
- **Screenshot:** PNG, JPEG, WebP or GIF up to 10 MB, stored as is. The server sends a copy downsized to the model's maximum long edge; the model returns title, visible text and a short description as structured output, which become the body.
- **Passages:** split on paragraph boundaries into chunks of roughly 300 tokens; embedded in batches.

## Search

- `GET /api/search?q=&kind=&from=&to=` runs three candidate lists over passages, 50 each: vector similarity, full text (`websearch_to_tsquery('simple', q)`), and trigram word similarity for fragments such as parts of error codes or URLs.
- Reciprocal rank fusion merges the lists, results are grouped per item by best passage, top 20 returned with a highlighted snippet and which kinds of match hit.
- Empty query lists recent items.

## API

All under `/api`: `GET /health`, `POST /items` (JSON for link and text, multipart for screenshot), `GET /items`, `GET /items/:id`, `GET /items/:id/image`, `POST /items/:id/retry`, `DELETE /items/:id`, `GET /search`.

## Web

One page: a capture bar (paste a URL or text, paste or drop a screenshot, optional note), a search box with kind and date filters, results with thumbnail or snippet and highlight, recent items when the search is empty, and an item view with full text, original link, status and retry. Pending items refresh until ready.

## Proof

- Integration tests against real Postgres; the Bedrock calls are passed in as functions and faked deterministically in tests. Unit tests for chunking, the address checks, and rank fusion.
- Eval: a fixture corpus of about 30 items mixing English, Dutch and French (some screenshots), and about 20 vague queries, each with its expected item. A script loads the corpus into a scratch database with real Bedrock and reports hits in the top 5 and mean reciprocal rank. Bar: at least 18 of 20 queries find their item in the top 5. Runs on demand, not in CI. Your personal query list stays out of the repo.
- CI: lint, typecheck and tests for both packages, Postgres as a service container. After the first green run, add its jobs as required checks on the `Main` ruleset.

## Slices

Each slice is one PR and leaves something usable.

### 1a. Text, end to end
- [x] Scaffold `server/` and `web/`, Biome, Compose with Postgres 18 + pgvector, migrations
- [x] Schema: items, passages, indexes
- [x] Save, list, get, delete for text items
- [x] Processing loop with startup reset and retry
- [x] Chunking and Cohere embeddings
- [x] Hybrid search with fusion, highlight and filters
- [x] Web: capture text, search, results, item view
- [x] Eval script and text corpus
- [x] CI workflow; README run instructions

### 1b. Links
- [ ] Safe fetch and Readability extraction
- [ ] Link capture and unreadable-page handling in the web app
- [ ] Link items in the eval corpus

### 1c. Screenshots
- [ ] Upload, storage and image endpoint
- [ ] Haiku 5.5 reading through the `eu.` profile
- [ ] Paste or drop in the web app, thumbnails in results
- [ ] Screenshot items in the eval corpus; eval meets the bar

## Open questions

- Does the Anthropic Bedrock Mantle client accept the `eu.anthropic.claude-haiku-5-5` profile id? If not, use the same SDK's `bedrock-runtime` client, which takes inference profile ids.

## Review

- **1a:** the eval loads 25 text items (English, Dutch, French, including near-duplicate topics as distractors) and finds all 16 vague queries at rank 1, most of them cross-language through meaning alone. Related passages score above 0.3 cosine similarity and unrelated ones below 0.22, so meaning matches below 0.25 are dropped; a nonsense query returns nothing. The web app talks to the server through types imported from `server/src/contract.ts` rather than Hono's RPC client, which would have pulled the server's whole dependency graph into the web type-check.
