# API read surface: design

## Context

The API serves `POST /links` and `GET /links/:id` over the `links` table alone. Enrichments are persisted by the worker as contract-v2 `result` jsonb in `enrichments`, keyed `(link_id, content_hash, prompt_version)`, each pointing at the `content_versions` row whose `extracted_text` its evidence offsets were verified against. The API already carries the Zod contract (`contract.ts`) and the durable spec already says the API validates enrichment results it serves; nothing exercises that yet. Routes live one per file under `routes/`, the `Db` interface is faked in unit tests and driven for real in `*.int.test.ts`, and the Bruno parity test fails CI when the collection and OpenAPI paths diverge. Link routes sit behind `apiKeyMiddleware` via `app.use("/links")` and `app.use("/links/*")`.

## Goals / Non-Goals

**Goals:**

- A list endpoint a UI can page through and filter by status and tag without one call per row.
- The stored analysis, served only after contract validation and only with evidence that resolves.
- Cross-origin access decided now: opt-in, exact origins, preflight independent of the API key.
- Same-commit parity of OpenAPI, Bruno, and demo tooling.

**Non-Goals:**

- UI, auth, search, multi-tag filters, sorting, time views, enrichment history, exposing extracted text (all in the proposal's out-of-scope list).
- New tables or indexes; the query paths are served by existing indexes at personal scale.

## Decisions

### 1. Separate enrichment endpoint; facets on the link representation

`GET /links/:id/enrichment` returns the full latest enrichment. The `Link` representation (returned by `POST /links`, `GET /links/:id`, and every list item) gains two facets from the latest valid enrichment: `tags: string[]` and `deadline: string | null` (the ISO date). Not enriched yet, or the stored result is invalid: `[]` and `null`.

- *Why not embed the whole enrichment in `GET /links/:id`*: evidence resolution needs the content version's `extracted_text`; doing that per list row would ship every page's text through the API for a listing. Splitting keeps the list cheap (one jsonb per row, no text) and keeps the evidence-resolving path single-row.
- *Why facets on the link at all*: a list filtered by tag that cannot show tags forces N+1 calls. `tags` and the deadline date are the two facets a list renders and filters or sorts by; reason and source stay with the evidence they depend on.
- *Why the date only*: a deadline's `reason` and `source` are meaningful next to the evidence rules; on a list row the date is what sorts and warns.

Response shape of the enrichment endpoint:

```json
{
  "link_id": "uuid",
  "created_at": "2026-09-01T10:00:00.000Z",
  "model_id": "anthropic.claude-…",
  "prompt_version": "bedrock-v3",
  "result": { "contract_version": "v2", "summary": "…", "key_takeaway": "…", "tags": ["…"], "deadline": { "date": "…", "reason": "…", "source": { "quote": "…", "start_offset": 0, "end_offset": 0 } }, "evidence": [ { "quote": "…", "start_offset": 0, "end_offset": 0 } ] }
}
```

`result` is the contract's `EnrichmentResult` schema registered as an OpenAPI component, so the document and the validator are the same definition. `deadline` is `null` when absent.

### 2. Validation and evidence resolution at the serving boundary

The route parses the stored `result` with `enrichmentResultSchema`. Then, with the linked content version's `extracted_text` loaded in the same query:

- an evidence item is kept only if its `quote` appears verbatim in the text (`includes`), otherwise dropped;
- a deadline whose `source` quote does not appear drops the whole `deadline` to `null`;
- a missing content version (nullable `content_version_id`) drops all evidence and the deadline.

Offsets are passed through as stored, not recomputed. The worker computed them as Python code-point offsets; JavaScript string indices are UTF-16 code units, so a slice-equality check in the API would spuriously fail on pages containing astral characters and recomputing would produce offsets inconsistent with the worker's. Presence of the verbatim quote is the invariant ("evidence is shown only when it resolves to stored extracted text"); offsets are documented in OpenAPI as code-point offsets into the extracted text. Dropped items are logged as a single-line JSON event with counts, mirroring the worker's `evidence dropped`.

A stored result that fails the contract is a data fault, not a client error: the endpoint returns `500 {"error": "enrichment_invalid"}` and logs the issues. For list and link facets the same failure degrades to empty facets plus a log line, so one bad row never hides the library. Pre-launch there are no such rows; the behaviour is defined so nobody has to guess later.

Alternative rejected: trusting the worker's verification and skipping the API check. The worker's check is at write time; the serving side is where "shown" happens, and the check costs one `includes` per item.

### 3. Latest enrichment per link is a LATERAL join

"Latest" is the `enrichments` row with the greatest `created_at` for the link. `getLink`, `listLinks`, and `getEnrichment` share one SQL fragment:

```sql
LEFT JOIN LATERAL (
  SELECT e.result, e.created_at, e.model_id, e.prompt_version, e.content_version_id
  FROM enrichments e WHERE e.link_id = l.id
  ORDER BY e.created_at DESC LIMIT 1
) latest ON true
```

Served by `enrichments_link_id_idx`. Enrichment history is not exposed, so nothing else is needed.

### 4. Keyset pagination on `(created_at, id)`

`GET /links?status=&tag=&limit=&cursor=`. Ordering is `created_at DESC, id DESC`; the cursor is the id of the last item served, documented as opaque. The next page is `WHERE (l.created_at, l.id) < (SELECT created_at, id FROM links WHERE id = $cursor)`. Response: `{ "items": Link[], "next_cursor": string | null }`. `limit` defaults to 20, maximum 100. A cursor that is not a UUID is `400 invalid_request`.

- *Why keyset over offset*: a library receives inserts while a UI pages; offset pagination skips or repeats rows. Keyset is one extra clause.
- *Why the row id rather than an encoded timestamp*: `created_at` has microsecond precision and JavaScript dates have milliseconds; a cursor carrying a truncated timestamp would skip rows created in the same millisecond. Comparing against the cursor row's own stored position has full precision by construction and needs no encoding. There is no delete endpoint, so the cursor row cannot vanish.
- *Why not total counts*: a count is a second query per page for a number the first UI does not need.

### 5. Filters: one status, one tag

`status` is the link status enum. `tag` is trimmed and lowercased on input, must be 1 to 50 characters (the contract's tag bounds), and matches with `latest.result->'tags' ? $tag` against the latest enrichment, so a link whose earlier enrichment carried the tag but whose latest does not is excluded, consistent with the facets shown. No GIN index: the filter runs after the LATERAL join over a personal-scale table; add one when a measurement says so.

Multiple tags, tag negation, and sorting are deferred; each is an additive query parameter later.

### 6. CORS: opt-in exact origins, preflight before the API key

Hono's bundled `hono/cors` middleware is registered on `*` before the API-key middleware, only when `CORS_ORIGINS` is set and non-empty. Configuration is a comma-separated list of exact origins (`http://localhost:5173,https://ui.example`), matched exactly against the request `Origin`; `allowHeaders` covers `content-type`, `x-api-key`, `idempotency-key`; `allowMethods` GET, POST, OPTIONS; no credentials mode (the key rides a header, cookies are not involved). Because the CORS middleware answers `OPTIONS` before the key check runs, preflight succeeds without a key while the actual request still needs one.

- *Why opt-in and exact*: the cloud environment has no UI yet; emitting `Access-Control-Allow-Origin: *` on an endpoint guarded by a header key invites browser callers nobody asked for. Exact origins are the smallest thing that serves a real UI.
- *Why decide now*: retrofitting CORS after a UI exists means debugging preflight against a deployed key check; deciding the ordering and the header list here costs a few lines and a test.
- Plumbing: `.env.example` documents `CORS_ORIGINS` (empty locally); Terraform gains `variable "cors_origins"` (default `""`) passed to the API container environment. No environment-specific value enters the repo.

### 7. API-key coverage needs no middleware change

`app.use("/links")` and `app.use("/links/*")` already match `GET /links` and `GET /links/:id/enrichment`. The change adds test cases asserting 401 without a key on both routes and that `/health`, `/openapi.json`, `/docs` stay open, so a later refactor of the pattern cannot silently uncover a route.

### 8. Database layer shape

`db/links.ts` gains `listLinks(pool, { status, tag, limit, cursor })` and `getLink` grows the LATERAL join; new `db/enrichments.ts` holds `getEnrichment(pool, linkId)` returning the latest row plus `extracted_text`, or `null`. `LinkRow` gains `latest_result: unknown | null`; the route layer (`routes/links/shared.ts`) validates it and derives the facets, keeping Zod out of the database module. `Db` and the test fake grow accordingly.

### 9. Demo and docs

`scripts/demo-cloud.sh`'s `show_enrichment` becomes a `curl` to `/links/$id/enrichment` piped to `jq`; `DATABASE_URL` stays required for the job-row inspection and requeue steps and the header comment says so. `docs/demo.md` drops the "reads the database directly" paragraph: the proof that evidence resolves is now the endpoint's documented rule and its tests, not an ad-hoc SQL join. The Bruno section lists five requests and each new `.bru` carries a `docs` block with the cloud-run note (the enrichment request 404s until the worker has finished; the list request needs only the key).

## Risks / Trade-offs

- [Offsets are code points, JS consumers assume code units] → documented in the OpenAPI description of `EvidenceItem`; a UI highlighting quotes should locate by `quote`, not by offset. Recomputing offsets in the API was rejected in Decision 2.
- [Tag filter scans the library] → personal scale; `LIMIT` bounds the page; index only on measurement.
- [List loads one `result` jsonb per row] → bounded by `limit ≤ 100` and the contract's 2000-char summary and 10 evidence items; no text is loaded for lists.
- [API key visible to a browser UI once CORS is on] → unchanged threat model: the key is spend protection on a throwaway environment and rotates per provision; real auth is deferred and listed out of scope.
- [Invalid stored result surfaces as 500] → deliberate: it is a server-side fault worth an alarm, and the list degrades to empty facets so the library stays browsable.

## Migration Plan

Additive API change, no schema migration. Deploy with the existing Deploy workflow after merge; `cors_origins` stays at its empty default. Verify `GET /links` and `GET /links/:id/enrichment` in Swagger UI at the cloud URL against a link enriched by the demo. Rollback is redeploying the previous image tag; no data is affected.

## Open Questions

None. The embed-versus-endpoint choice, pagination style, single-tag filter, and opt-in CORS are decided above; each rejected alternative is recorded next to its decision.
