## ADDED Requirements

### Requirement: List links, newest first, with keyset pagination
The API SHALL serve `GET /links` returning stored links ordered by creation time descending (ties broken by id descending) as `{ "items": Link[], "next_cursor": string | null }`. `limit` SHALL default to 20 and accept at most 100. `next_cursor` SHALL be an opaque token identifying the last item served, and passing it back as `cursor` SHALL return the items that follow it under the same ordering and filters; `next_cursor` SHALL be `null` when no items follow. Links created between two page requests SHALL NOT cause an item to be skipped or repeated across the pages after it.

#### Scenario: First page and continuation
- **GIVEN** 25 stored links
- **WHEN** a client sends `GET /links?limit=10`, then `GET /links?limit=10&cursor=<next_cursor>` twice more
- **THEN** the three responses contain 10, 10, and 5 items in descending creation order with no item repeated or missing
- **AND** the third response carries `next_cursor: null`

#### Scenario: Inserts during paging do not shift the page
- **GIVEN** a client has fetched the first page and holds its `next_cursor`
- **WHEN** a new link is created and the client fetches the next page with that cursor
- **THEN** the second page contains exactly the items that followed the first page's last item, and the new link does not appear on it

#### Scenario: Limit bounds and malformed cursor are rejected
- **WHEN** a client sends `GET /links?limit=0`, `GET /links?limit=101`, or `GET /links?cursor=not-a-cursor`
- **THEN** the response is `400 Bad Request` with a JSON error body

#### Scenario: Empty library
- **GIVEN** no stored links match
- **WHEN** a client sends `GET /links`
- **THEN** the response is `200 OK` with `items: []` and `next_cursor: null`

### Requirement: List filters by status and tag
`GET /links` SHALL accept `status` (one of `pending`, `enriched`, `failed`) and `tag` (a single tag) as optional filters, combinable. `tag` SHALL be trimmed and lowercased before matching and SHALL be 1 to 50 characters after that; a link matches when the tag is one of the tags of its latest valid enrichment. Links without an enrichment SHALL NOT match any tag filter.

#### Scenario: Filter by status
- **GIVEN** links in status `pending`, `enriched`, and `failed`
- **WHEN** a client sends `GET /links?status=enriched`
- **THEN** every returned item has `status: "enriched"` and no matching link is omitted

#### Scenario: Filter by tag matches the latest enrichment
- **GIVEN** a link whose latest enrichment carries the tags `["python", "eol"]` and another whose latest enrichment carries `["essay"]`
- **WHEN** a client sends `GET /links?tag=Python`
- **THEN** only the first link is returned

#### Scenario: Superseded tags do not match
- **GIVEN** a link with an older enrichment tagged `["python"]` and a newer enrichment tagged `["rust"]`
- **WHEN** a client sends `GET /links?tag=python`
- **THEN** the link is not returned

#### Scenario: Invalid filter values are rejected
- **WHEN** a client sends `GET /links?status=done` or `GET /links?tag=` or a `tag` longer than 50 characters
- **THEN** the response is `400 Bad Request` with a JSON error body

### Requirement: Serve the latest enrichment of a link
The API SHALL serve `GET /links/:id/enrichment` returning the link's most recently created enrichment as `{ link_id, created_at, model_id, prompt_version, result }`, where `result` is the contract-v2 enrichment result with `deadline` either the complete object or `null`. A well-formed id matching no link SHALL return `404` with error `link_not_found`; a link that has no enrichment SHALL return `404` with error `enrichment_not_found`; a malformed id SHALL return `400`.

#### Scenario: Enriched link
- **GIVEN** a link whose job completed and persisted an enrichment
- **WHEN** a client sends `GET /links/:id/enrichment`
- **THEN** the response is `200 OK` with `link_id` equal to the link's id and `result` carrying `contract_version: "v2"`, `summary`, `key_takeaway`, `tags`, `deadline`, and `evidence`

#### Scenario: Latest of several enrichments
- **GIVEN** a link with two enrichments created at different times
- **WHEN** a client sends `GET /links/:id/enrichment`
- **THEN** the response carries the later one's `result`, `created_at`, `model_id`, and `prompt_version`

#### Scenario: Not yet enriched
- **GIVEN** a link in status `pending` or `failed` with no enrichment row
- **WHEN** a client sends `GET /links/:id/enrichment`
- **THEN** the response is `404 Not Found` with error `enrichment_not_found`

#### Scenario: Unknown or malformed id
- **WHEN** a client sends `GET /links/:id/enrichment` with an unknown UUID, or with an id that is not a UUID
- **THEN** the response is `404` with error `link_not_found`, respectively `400`

### Requirement: Served enrichments are contract-validated and evidence-resolved
Before serving, the API SHALL parse the stored result with the Zod contract definition. A stored result that fails validation SHALL be served as `500` with error `enrichment_invalid` and logged with the validation issues; it SHALL NOT be repaired or partially served. The API SHALL then keep an evidence item only if its `quote` appears verbatim in the `extracted_text` of the content version the enrichment references; a `deadline` whose `source` quote does not appear SHALL be served as `null`; when the enrichment references no content version, all evidence SHALL be dropped and `deadline` served as `null`. Offsets SHALL be served as stored. Dropped items SHALL be logged.

#### Scenario: Resolvable evidence is served unchanged
- **GIVEN** a stored enrichment whose evidence quotes and deadline source quote all appear in the referenced extracted text
- **WHEN** a client fetches the enrichment
- **THEN** every stored evidence item and the deadline are present in the response with their stored offsets

#### Scenario: Unresolvable evidence is dropped, not guessed
- **GIVEN** a stored enrichment with three evidence items, one quoting text absent from the referenced extracted text
- **WHEN** a client fetches the enrichment
- **THEN** the response contains the two resolvable items only, and a log entry records one dropped item

#### Scenario: Unresolvable deadline source drops the deadline
- **GIVEN** a stored enrichment whose `deadline.source.quote` does not appear in the referenced extracted text
- **WHEN** a client fetches the enrichment
- **THEN** the response has `deadline: null` and its tags and summary are served unchanged

#### Scenario: Invalid stored result is reported
- **GIVEN** a stored enrichment whose `result` violates the contract (for example a missing `tags` field)
- **WHEN** a client fetches the enrichment
- **THEN** the response is `500` with error `enrichment_invalid`, and a log entry records the validation issues

### Requirement: Read routes are protected by the API key
When the deployment configures `API_KEY`, `GET /links` and `GET /links/:id/enrichment` SHALL require the same `x-api-key` header as the existing link routes and SHALL return `401` with error `unauthorized` without it. `GET /health`, `/openapi.json`, and `/docs` SHALL remain open. Without `API_KEY` configured, the read routes SHALL require no key.

#### Scenario: Read routes reject a missing or wrong key
- **GIVEN** an API started with `API_KEY` set
- **WHEN** a client sends `GET /links` or `GET /links/:id/enrichment` without `x-api-key`, or with a wrong value
- **THEN** the response is `401` with error `unauthorized` and no data is returned

#### Scenario: Read routes accept the key
- **GIVEN** an API started with `API_KEY` set
- **WHEN** a client sends `GET /links` with the correct `x-api-key`
- **THEN** the request is served normally

### Requirement: Cross-origin access is opt-in by exact origin
The API SHALL read `CORS_ORIGINS`, a comma-separated list of exact origins. When it is unset or empty, responses SHALL carry no CORS headers. When set, requests whose `Origin` exactly matches a listed origin SHALL receive `Access-Control-Allow-Origin` echoing that origin, and preflight `OPTIONS` requests to any route SHALL succeed without an API key, allowing methods `GET`, `POST`, `OPTIONS` and headers `content-type`, `x-api-key`, `idempotency-key`. An `Origin` not in the list SHALL receive no `Access-Control-Allow-Origin` header. The variable SHALL be documented in `.env.example` and configurable per cloud deployment without a code change.

#### Scenario: No configuration, no CORS
- **GIVEN** an API started without `CORS_ORIGINS`
- **WHEN** a client sends `GET /health` with `Origin: http://localhost:5173`
- **THEN** the response carries no `Access-Control-Allow-Origin` header

#### Scenario: Listed origin is allowed and preflight needs no key
- **GIVEN** an API started with `API_KEY` set and `CORS_ORIGINS=http://localhost:5173`
- **WHEN** a browser sends `OPTIONS /links` with `Origin: http://localhost:5173`, `Access-Control-Request-Method: POST`, and `Access-Control-Request-Headers: x-api-key, idempotency-key, content-type`, without `x-api-key`
- **THEN** the response is successful, allows origin `http://localhost:5173`, method `POST`, and the requested headers
- **AND** a following `GET /links` with the same `Origin` and a valid key carries `Access-Control-Allow-Origin: http://localhost:5173`

#### Scenario: Unlisted origin is not allowed
- **GIVEN** an API started with `CORS_ORIGINS=http://localhost:5173`
- **WHEN** a client sends `GET /links` with `Origin: https://evil.example` and a valid key
- **THEN** the response carries no `Access-Control-Allow-Origin` header
