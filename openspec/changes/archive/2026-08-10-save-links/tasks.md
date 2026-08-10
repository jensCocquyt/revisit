# Tasks: save-links

## 1. Test harness for PostgreSQL integration tests

- [x] 1.1 Add integration test setup in `apps/api/test`: connect via `DATABASE_URL`, fail loudly (not skip silently) when unset, and a helper for asserting row counts scoped to a link/key
- [x] 1.2 Add a PostgreSQL service container to the `api` job in `.github/workflows/ci.yml` and export `DATABASE_URL` for `npm test`

## 2. Validation and normalization

- [x] 2.1 Add the request schema (Zod, `strict()`): `url` required absolute http/https ≤ 2048, `note` ≤ 2000, `goal` ≤ 200; plus `Idempotency-Key` header rule (non-empty, ≤ 200) — with unit tests for accept/reject boundaries
- [x] 2.2 Add URL normalization (lowercase scheme/host, strip default port, drop fragment) and the canonical request hash (SHA-256 over normalized url/note/goal) — with unit tests proving determinism and that note/goal omission vs null hash identically

## 3. Persistence

- [x] 3.1 Extend `Db` with `getLink(id)` and `findIdempotencyKey(key)` — integration-tested against PostgreSQL
- [x] 3.2 Extend `Db` with `createLinkWithJob(...)`: one transaction inserting link + enrichment job + idempotency key, rolling back on any failure; surface unique-violation on the key distinctly — integration test asserts link, job (pending/0 attempts/available now), and key rows all exist after commit

## 4. Endpoints

- [x] 4.1 Introduce `OpenAPIHono` in `app.ts` (keep `/health` green) and add `POST /links`: validate → key lookup (replay 200 / conflict 409) → create (201) → unique-violation race fallback to replay — with integration tests for 201, replay, 409, and 400s creating no rows
- [x] 4.2 Add `GET /links/:id`: 200 with stored representation, 404 unknown, 400 malformed UUID — with integration tests
- [x] 4.3 Integration test: forced mid-transaction failure (job insert throws) returns 5xx and leaves zero link/job/key rows
- [x] 4.4 Integration test: two concurrent identical submissions yield exactly one link/job pair and both responses return that link

## 5. Documentation and Bruno collection

- [x] 5.1 Serve `/openapi.json` and Swagger UI at `/docs`; document both routes including the `Idempotency-Key` header and error responses; test that the document lists both paths
- [x] 5.2 Create the Bruno collection at `bruno/`: `bruno.json`, `environments/local.bru` (`baseUrl`), and requests for `GET /health`, `POST /links` (Idempotency-Key header + example body, captures `linkId`), `GET /links/:id`
- [x] 5.3 Add the sync test: parse method+url from every `.bru` file and assert two-way set equality with the OpenAPI document's paths, so endpoint/collection drift fails CI

## 6. Verification and conventions

- [x] 6.1 Run `npm run lint`, `npm test` (full suite), and the compose stack (`docker compose up --build` or CI stack job) to confirm `/health`, `/docs`, and a save-then-get round trip work — the round trip via the Bruno collection (Bruno CLI or app) against the local stack
- [x] 6.2 Update `CLAUDE.md`: reflect the new endpoints (drop the "only /health exists" framing) and record the standing convention that `bruno/` is updated in the same commit as any endpoint change, enforced by the sync test
