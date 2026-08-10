# Design: save-links

## Context

PR 1 left the API with only `GET /health`, a `Db` interface exposing `ping()`, and migrated tables (`links`, `enrichment_jobs`, `idempotency_keys`) that no code touches. This change wires the capture path onto that foundation. The worker is untouched; it gains claimable rows, nothing more.

## Goals / Non-Goals

**Goals:**
- `POST /links` and `GET /links/:id` with validation, idempotency, and atomic link + job creation.
- OpenAPI documentation for both endpoints.
- Integration tests against real PostgreSQL proving the invariants.

**Non-Goals:**
- Job claiming, leases, worker changes, fetching, enrichment.
- Repository/service abstractions beyond what these two endpoints need.
- Auth, rate limiting, collection listing.

## Decisions

### Transaction boundary

One `pg` pool client per submission, explicit `BEGIN`/`COMMIT`/`ROLLBACK`:

```
BEGIN
  INSERT INTO links (url, normalized_url, note, goal) VALUES (...) RETURNING *
  INSERT INTO enrichment_jobs (link_id) VALUES (...)          -- defaults: pending, 0, now()
  INSERT INTO idempotency_keys (key, request_hash, link_id) VALUES (...)
COMMIT
```

The idempotency row is written in the **same transaction** as the link and job: a partially-committed submission can never leave a key pointing at a missing link, and a failed transaction leaves the key unclaimed for a clean retry. Only fast local inserts happen inside the transaction (invariant: no slow work in a transaction — trivially satisfied here since the API does no fetching).

The `Db` interface grows purpose-built methods (e.g. `createLinkWithJob(...)`, `getLink(id)`, `findIdempotencyKey(key)`); no generic transaction helper or repository layer.

### Idempotency behavior

- **Key storage**: `idempotency_keys.key` is the primary key; insert races resolve at the database, not in application code.
- **Request hash**: SHA-256 over a canonical JSON of `{normalized_url, note, goal}` (missing optionals normalized to null). Stored in `request_hash`.
- **Flow**: look up the key first. Hit + same hash → return stored link (`200`). Hit + different hash → `409`. Miss → attempt the insert transaction.
- **Concurrent duplicates**: two racing requests both miss the lookup; one commits, the other's `idempotency_keys` insert fails with a unique violation, rolling back its link + job atomically. The loser re-reads the key and serves the winner's link. Exactly one link/job pair survives — guaranteed by the primary key, not by locking.
- **Replay status code**: `200` on replay vs `201` on first creation. The body is identical, so a client that retries blindly still works.

Note: keys are global (single-user MVP, matches the existing table). Key expiry/cleanup is deferred — the table is small at MVP scale.

### URL normalization

Minimal and deterministic, used for `normalized_url` and the request hash: parse with WHATWG `URL`, lowercase scheme + host, strip default ports, drop the fragment. No query reordering or tracking-param stripping — that's guesswork, and `normalized_url` currently backs no uniqueness constraint.

### Validation

Zod v4 schema in the API (`strict()` — unknown fields rejected, consistent with the contract's parity rules): `url` required, ≤ 2048 chars, must parse as absolute `http`/`https`; `note` ≤ 2000; `goal` ≤ 200. Limits are new (the build spec sets none); chosen to comfortably fit the contract's own text limits. `Idempotency-Key` header: required, non-empty, ≤ 200 chars. Validation runs before any database access.

### OpenAPI

`@hono/zod-openapi` replaces the bare `Hono` app in `app.ts` (`OpenAPIHono` is a drop-in superclass; `/health` keeps working). Routes are defined with `createRoute` so the Zod validation schemas *are* the documentation — no drift. Serve the JSON document at `/openapi.json` and Swagger UI (via `@hono/swagger-ui`) at `/docs`. This is new infrastructure, justified: these are the first documented endpoints and Swagger is the MVP's demonstration surface; adding it now while the surface is two endpoints is the cheap moment.

### Bruno collection and sync enforcement

Hand-written collection at repo-root `bruno/`: `bruno.json`, one `.bru` file per request (`health.bru`, `save-link.bru`, `get-link.bru`), and `environments/local.bru` defining `baseUrl` (`http://localhost:3000`). Requests use `{{baseUrl}}` and a captured `linkId` variable so save → get chains in a Bruno run.

"In sync" is enforced mechanically, not by discipline: a vitest test builds the app, reads the OpenAPI document's paths, parses `method` + `url` out of every `.bru` file (the format is line-oriented; a small parser in the test, no Bruno dependency), and asserts set equality in both directions — every documented route has a request, every request targets a documented route. Adding an endpoint without touching `bruno/` fails CI with the missing path named. The collection's request *bodies* are examples and not schema-checked; the OpenAPI/Zod coupling already guards shape drift, and duplicating it against `.bru` bodies would be a second source of truth.

This is a standing convention from this change forward (recorded in `CLAUDE.md`): any change that adds, removes, or reshapes an endpoint updates `bruno/` in the same commit.

### Database changes

None expected. Existing columns and defaults cover everything: `links.status` defaults to `pending`, `enrichment_jobs` defaults cover `status`/`attempts`/`available_at`, `idempotency_keys` has the key as primary key. No new migration unless implementation uncovers a gap.

### Testing

- **Integration tests (vitest) against real PostgreSQL** via `DATABASE_URL`, using the compose postgres locally and a `services: postgres` container in the CI `api` job. Tests exercise the app via Hono's `app.request()` — no HTTP server needed.
- **Atomicity test**: force the job insert to fail (e.g. a db wrapper whose job insert is made to throw mid-transaction, or dropping a required value at the call site) and assert zero new rows in `links` and `enrichment_jobs`.
- **Concurrency test**: fire two identical submissions with `Promise.all`, assert one link/job pair and both responses agree.
- Existing unit tests (`/health`, contract fixtures) keep running without a database; integration tests live in their own file and skip with a clear failure message if `DATABASE_URL` is unset rather than silently passing.

## Risks / Trade-offs

- [Replay returns `200`, not `201`] → Documented in OpenAPI; body is identical so clients are unaffected.
- [Global idempotency keys collide across future users] → Acceptable for single-user MVP; multi-user auth change will scope the key.
- [No `normalized_url` uniqueness — the same URL can be saved twice with different keys] → Intentional: the build spec dedupes retries by idempotency key, not by URL.
- [CI now needs PostgreSQL in the `api` job] → Standard GitHub Actions service container; mirrors what the `stack` job already proves.
- [Integration tests share one database] → Each test uses fresh UUIDs/keys; tests assert on rows they created, not global counts, except in targeted count assertions scoped to the request's key.

## Open Questions

- None blocking. Field length limits (2048/2000/200) are proposed here, not spec-mandated — flag at review if product wants different bounds.
