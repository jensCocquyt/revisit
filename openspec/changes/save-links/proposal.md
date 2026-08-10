# Proposal: save-links

## Why

The foundation (PR 1) shipped a healthy stack with migrated tables that nothing reads or writes. The product cannot demonstrate its first step — capture — until a client can save a link and retrieve it. Saving must also create the durable enrichment job so the worker change that follows has work to claim; this is the first half of PR 2 in the build spec.

## What Changes

- Add `POST /links`: accepts `url` (required), `note` (optional), `goal` (optional), requires an `Idempotency-Key` header, validates and normalizes the request, and creates a `pending` link plus exactly one `pending` enrichment job in a single PostgreSQL transaction. Returns `201 Created` with the stored link.
- Add `GET /links/:id`: returns the current stored representation of a link, `404` for unknown IDs.
- Request idempotency: the idempotency key is stored with a hash of the normalized request. Same key + same request replays the original link (no new rows); same key + different request returns `409 Conflict`.
- Validation failures (missing/invalid URL, over-limit field lengths, missing idempotency key) return `4xx` and create no database records.
- Introduce OpenAPI documentation for the API and register both endpoints in it. (No OpenAPI setup exists yet; this change adds the minimal version because these are the first real endpoints and the build spec makes Swagger the demonstration surface.)
- Add an importable Bruno collection (`bruno/`) covering every API endpoint, with a local environment. A test asserts the collection matches the OpenAPI document, so drift fails CI. Keeping the collection in sync is a standing convention from this change on.
- Add integration tests against PostgreSQL covering creation, retrieval, idempotent replay, key-conflict, validation rejection, and transaction atomicity under a forced failure.

No new runtime infrastructure: the existing `links`, `enrichment_jobs`, and `idempotency_keys` tables already carry the needed columns. Any schema change is limited to constraints/columns this change actually uses.

### Out of scope

- Worker polling, `FOR UPDATE SKIP LOCKED`, job claiming, leases, retries, or failed-job recovery (next change).
- Fetching the saved URL, content extraction, AI or stub enrichment execution, follow-up classification, evidence.
- Embeddings/pgvector, SQS or any broker, object storage, cloud infrastructure.
- `GET /links` collection listing/filtering.
- Authentication.

## Capabilities

### New Capabilities

- `link-capture`: submitting a link with optional context and retrieving it by ID — validation, idempotent submission, atomic link + enrichment-job creation, and the stored representation exposed by the API.

### Modified Capabilities

None. `openspec/specs/` is empty; no existing capability requirements change.

## Impact

- `apps/api`: new route handlers, request validation schema, normalization + request-hash logic, transactional persistence in the db layer, OpenAPI document + Swagger UI wiring, integration tests (require a reachable PostgreSQL).
- `bruno/`: new top-level Bruno collection (requests + local environment), plus an API test that keeps it aligned with the OpenAPI document.
- `db/migrations`: at most a small additive migration if a constraint is missing; existing tables are otherwise used as-is.
- `apps/worker`, `contracts/`: untouched. The enrichment result contract is not involved in this change.
- CI: API job may need a PostgreSQL service for integration tests.
