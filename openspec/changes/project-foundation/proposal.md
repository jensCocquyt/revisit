## Why

Revisit has a complete build specification (docs/build-spec.md) but no code. Every later change — link submission, job processing, real enrichment — needs a running local stack, a database with migrations, shared contracts, and CI to build on. This change delivers PR 1 of the build spec: a foundation where `docker compose up` produces a healthy three-container system with zero external credentials.

## What Changes

- New TypeScript API workspace (Hono) with a health endpoint and unit-test/lint/format tooling.
- New Python worker workspace with a health signal and unit-test/lint/format tooling.
- PostgreSQL migrations creating the core tables (`links`, `enrichment_jobs`, `enrichments`, `content_versions`, `idempotency_keys`).
- Docker Compose running PostgreSQL, the API, and the worker for local development.
- Versioned enrichment result contract defined once and enforced in both languages.
- Deterministic enrichment stub implementing the AI interface, usable offline as the default.
- GitHub Actions CI running formatting, linting, and unit tests for both workspaces.
- `.env.example` documenting all required environment configuration.

Out of scope (later changes): `POST /links` and other product endpoints, job claiming/processing, URL fetching and content extraction, real LLM (Bedrock) integration, cloud infrastructure, pgvector/embeddings/SQS/object storage.

New infrastructure introduced (PostgreSQL, Docker Compose, GitHub Actions) is the minimum the build spec's architecture requires; no broker, object storage, or cloud resources are added.

## Capabilities

### New Capabilities

- `dev-stack`: Local development environment — Docker Compose starts PostgreSQL, API, and worker; both services expose passing health checks; configuration comes from environment variables documented in `.env.example`; no external API keys required.
- `database-schema`: Migration tooling and the core schema — migrations run to completion on a fresh database and are the only way schema changes are applied.
- `enrichment-contract`: The versioned enrichment result contract and the deterministic AI stub — a single source of truth validated in both TypeScript and Python, with a stub that returns schema-valid, deterministic results offline.
- `ci-pipeline`: Quality gates — formatting, linting, and unit tests for both workspaces run locally with single commands and on GitHub Actions for every push/PR.

### Modified Capabilities

None — this is the first change; no existing specs.

## Impact

- New code: `apps/api` (TypeScript), `apps/worker` (Python), `db/migrations`, `contracts/`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example`.
- No existing code affected (empty repo).
- Dependencies introduced: Hono, a TS migration/query layer, Python tooling (ruff, pytest), Docker Compose, GitHub Actions.
- Sets the conventions (layout, naming, test commands) all subsequent changes follow.
