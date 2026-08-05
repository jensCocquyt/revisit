## 1. Repository scaffolding

- [x] 1.1 Create monorepo layout: `apps/api`, `apps/worker`, `contracts`, `db/migrations`; add root `.gitignore` entries for Node, Python, and env files
- [x] 1.2 Create `.env.example` with all variables the stack reads (database URL, ports, `ENRICHER=stub`), with working local defaults

## 2. Enrichment contract

- [x] 2.1 Write `contracts/enrichment/v1.schema.json` covering summary, takeaway, topics, suggested group, save intent, recommended action, optional revisit suggestion, evidence, and `contract_version`
- [x] 2.2 Add a small set of shared fixtures in `contracts/enrichment/fixtures/`: valid examples (including `none` and `revisit` outcomes) and invalid examples (missing summary, unknown intent, `revisit` without reason/date) — used as examples, unit-test inputs, and by the Compose smoke test

## 3. Database migrations

- [x] 3.1 Write SQL migrations for `links`, `enrichment_jobs`, `enrichments`, `content_versions`, `idempotency_keys` per the build spec, including the enrichments unique key `(link_id, content_hash, prompt_version)`, job lease columns, and foreign keys
- [x] 3.2 Add dbmate configuration and verify migrations apply cleanly and idempotently against a local PostgreSQL

## 4. TypeScript API workspace

- [x] 4.1 Scaffold `apps/api`: Hono app, TypeScript config, Biome, Vitest, and `format`/`lint`/`test` scripts
- [x] 4.2 Implement `GET /health` with a `SELECT 1` database round-trip; return non-200 when the database is unreachable
- [x] 4.3 Add Ajv validation of the enrichment contract at the API boundary (results the API serves) with unit tests using shared fixtures (valid accepted, invalid rejected)
- [x] 4.4 Add unit tests for the health handler (healthy and DB-down paths, DB access faked)

## 5. Python worker workspace

- [x] 5.1 Scaffold `apps/worker`: uv project, ruff, pytest, and `format`/`lint`/`test` commands; idle main loop that logs a heartbeat
- [x] 5.2 Define the `Enricher` protocol and implement `StubEnricher` returning deterministic, contract-valid results derived from the content hash; select via `ENRICHER` env var with stub as default
- [x] 5.3 Add `jsonschema` validation of the enrichment contract at the worker boundary (results before persistence) with unit tests using shared fixtures
- [x] 5.4 Add unit tests for the stub: determinism (same input → identical result) and schema validity
- [x] 5.5 Implement `python -m worker.healthcheck` verifying database connectivity, with unit tests for success and failure exit codes

## 6. Docker Compose stack

- [x] 6.1 Write Dockerfiles for API (Node 24) and worker (Python 3.12)
- [x] 6.2 Write `docker-compose.yml`: PostgreSQL with healthcheck, `migrate` service (dbmate) gated on healthy PostgreSQL, API and worker gated on successful migration; API healthcheck hits `/health`, worker healthcheck runs `worker.healthcheck`
- [x] 6.3 Verify acceptance: from a clean checkout with copied `.env.example`, `docker compose up` reaches all-services-healthy with no external credentials (local note: images built via `docker build` due to a Docker Desktop compose-build bug; compose build path verified in CI)

## 7. CI pipeline

- [ ] 7.1 Add `.github/workflows/ci.yml` with `api` job (Biome check + Vitest) and `worker` job (ruff format check + ruff lint + pytest) on push and PR to `main`
- [ ] 7.2 Add `stack` job: build images, `docker compose up -d --wait`, assert all services healthy, exercise the stub enricher against a shared fixture inside the worker container, then tear down
- [ ] 7.3 Push a branch and verify all three jobs pass; verify an intentional lint violation fails CI, then remove it

## 8. Documentation

- [ ] 8.1 Update README: project overview, prerequisites, one-command startup, per-workspace format/lint/test commands, and layout map
