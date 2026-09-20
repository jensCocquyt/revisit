# API read surface: tasks

## 1. Link representation with facets

- [x] 1.1 Extend `getLink` in `apps/api/src/db/links.ts` with the latest-enrichment LATERAL join; `LinkRow` gains `latest_result: unknown | null`; update `fakes.ts` and existing fixtures
- [x] 1.2 In `routes/links/shared.ts`, derive `tags` and `deadline` (date or `null`) from `latest_result` via `enrichmentResultSchema`; invalid result logs one JSON line and yields empty facets; `linkResponseSchema` gains both fields
- [x] 1.3 Unit tests: facets from a valid result, empty facets for `null` and for an invalid result (with log); integration test: `GET /links/:id` after inserting two enrichments shows the newer one's facets, `POST /links` returns `tags: []`, `deadline: null`

## 2. Enrichment endpoint

- [x] 2.1 Add `apps/api/src/db/enrichments.ts` with `getEnrichment(pool, linkId)` returning the latest row (`result`, `created_at`, `model_id`, `prompt_version`) plus the referenced content version's `extracted_text` (nullable), or `null`; wire into `Db` and the fake
- [x] 2.2 Add `routes/links/get-enrichment.ts`: `GET /links/{id}/enrichment`, contract parse (`500 enrichment_invalid` + log on failure), evidence and deadline-source presence check against `extracted_text` (drop, log counts), `404 link_not_found` / `404 enrichment_not_found`; register `EnrichmentResult` as an OpenAPI component with the code-point offset note on `EvidenceItem`
- [x] 2.3 Unit tests with fakes: served unchanged when resolvable, one of three items dropped, deadline dropped, invalid result is 500, both 404 codes, malformed id is 400; integration test: worker-shaped rows inserted directly, latest of two enrichments is served

## 3. List endpoint

- [x] 3.1 Add `listLinks(pool, { status, tag, limit, afterId })` in `db/links.ts` using the shared LATERAL join, a keyset clause against the cursor row's `(created_at, id)`, `result->'tags' ? $tag`, `ORDER BY created_at DESC, id DESC LIMIT limit + 1` to derive `hasMore` (cursor is the last item's id; see design decision 4)
- [x] 3.2 Add `routes/links/list-links.ts`: query schema (`status` enum, `tag` trimmed and lowercased then 1 to 50 chars, `limit` 1 to 100 default 20, `cursor` UUID), response `{ items, next_cursor }`, `400` on bad cursor
- [x] 3.3 Integration tests against PostgreSQL: three-page walk over 25 links with no repeats or gaps, insert during paging does not shift the second page, status filter, tag filter is case-insensitive and matches only the latest enrichment, links without enrichment never match a tag, empty result, bad `limit`, `status`, `tag`, and `cursor` are 400

## 4. Cross-origin access and key coverage

- [x] 4.1 Add `corsOrigins?: string[]` to `AppOptions`; register `hono/cors` on `*` before the API-key middleware only when non-empty (exact origin match, methods GET/POST/OPTIONS, headers content-type/x-api-key/idempotency-key); `index.ts` parses `CORS_ORIGINS` (comma-separated, trimmed, empties dropped)
- [x] 4.2 Tests: no header without configuration, preflight on `/links` succeeds without a key and echoes the listed origin, actual request with key carries the origin, unlisted origin gets no header
- [x] 4.3 Extend `api-key.test.ts`: `GET /links` and `GET /links/:id/enrichment` return 401 without and with a wrong key, pass with the key; open routes unchanged
- [x] 4.4 Document `CORS_ORIGINS` in `.env.example` (empty by default); add `variable "cors_origins"` (default `""`) in `terraform/stack/variables.tf` and pass it as `CORS_ORIGINS` in the API container environment in `ecs.tf`

## 5. OpenAPI, Bruno, docs, demo

- [x] 5.1 Update `openapi.test.ts`: path set includes `/links` GET and `/links/{id}/enrichment`, list query parameters documented, `EnrichmentResult` component present, `ApiKey` security on both read routes
- [x] 5.2 Add `bruno/list-links.bru` (`GET {{baseUrl}}/links?limit=20`, `x-api-key`) and `bruno/get-enrichment.bru` (`GET {{baseUrl}}/links/{{linkId}}/enrichment`), each with a `docs` block including the cloud-run note; fix `seq` numbers; `bruno.test.ts` passes
- [x] 5.3 `scripts/demo-cloud.sh`: replace the `psql` body of `show_enrichment` with `curl` to `/links/$id/enrichment` piped to `jq`; update the header comment on what `DATABASE_URL` is still for; `docs/demo.md`: step table wording, drop the "reads the database directly" paragraph, Bruno section lists five requests
- [x] 5.4 `README.md`: list the four link endpoints and `CORS_ORIGINS` where the API is described

## 6. Verification and delivery

- [x] 6.1 `npm run lint` and `npm test` with `DATABASE_URL` green in `apps/api`; `npm run build` compiles
- [x] 6.2 Local stack: save a link, exercise `GET /links?tag=<tag>` and `GET /links/:id/enrichment` (seeded enrichment with one unresolvable evidence item, dropped and logged), cursor paging, CORS preflight, Swagger UI at `/docs`; Bruno collection run with `--env local`, all five requests pass
- [x] 6.3 Grep the diff for em dashes, `U[0-9]`, `FR-`, `AC-`, `§`, `docs/` in code; open the PR; work the review loop
- [ ] 6.4 After merge: dispatch the Deploy workflow, run `scripts/demo-cloud.sh`, and verify both endpoints in Swagger UI at the cloud URL against the demo's enriched link
