## Context

Empty repository with a complete build spec (docs/build-spec.md). This change lays down PR 1: the workspaces, database, contracts, local stack, and CI that every later change builds on. Two languages (TypeScript API, Python worker) share one PostgreSQL database and one enrichment result contract, so the foundational decisions here — layout, migration tooling, contract source of truth, health-check model — are the ones hardest to reverse later.

## Goals / Non-Goals

**Goals:**
- `docker compose up` starts PostgreSQL, API, and worker; all become healthy with no external credentials.
- Migrations create the five core tables and are the only mechanism for schema change.
- One versioned enrichment contract, validated identically in TypeScript and Python.
- Deterministic offline enrichment stub behind an AI interface.
- Formatting, linting, and unit tests pass locally and in GitHub Actions.

**Non-Goals:**
- No product endpoints (`POST /links` etc.), no job claiming/processing, no URL fetching, no Bedrock, no cloud infrastructure, no broker/embeddings/object storage.
- No speculative abstractions for deferred architecture (e.g., no queue interface "ready for SQS").

## Decisions

### 1. Repository layout: simple monorepo, no workspace manager

```text
apps/api/          TypeScript Hono API
apps/worker/       Python worker
contracts/         versioned enrichment contract + shared fixtures
db/migrations/     plain SQL migrations
docker-compose.yml
.github/workflows/ci.yml
.env.example
```

One TS package and one Python package — pnpm/npm workspaces or a monorepo tool would manage nothing. Each app is self-contained with its own dependency manifest and Dockerfile. Revisit only if a third TS package appears.

### 2. Migrations: plain SQL run by dbmate

Alternatives: node-pg-migrate (ties schema to the TS app; worker also owns tables), Alembic (ties it to Python), hand-rolled runner (needless code).

dbmate is a single binary, SQL-first, language-neutral, and runs as a short-lived Compose service (`migrate`) that the API and worker `depends_on` with `condition: service_completed_successfully`. The same command runs in CI. Schema belongs to the system, not to either language.

### 3. Contract source of truth: JSON Schema, validated natively in both languages

> **Superseded by the `contract-native-types` change (same PR):** the shared JSON Schema was replaced with native definitions — a Zod schema in the API and pydantic models in the worker — with the shared fixtures as the cross-language conformance suite. See `openspec/changes/contract-native-types/` for the decision record. The section below is kept as the original rationale.

Alternatives: Zod as truth + codegen to Python (codegen pipeline for one schema is overkill); duplicate Zod + Pydantic definitions kept in sync by convention (drift is silent).

`contracts/enrichment/v1.schema.json` is the single source. Validation happens at the boundaries: the worker validates results it produces (Python `jsonschema`) and the API validates enrichments it serves (Ajv). A small set of shared fixtures in `contracts/enrichment/fixtures/` serves as examples, feeds unit tests on each side, and backs the Compose smoke test. Full cross-language conformance testing (every fixture asserted identically in both languages) is deferred until contract complexity justifies it. The contract carries a `contract_version` field; the filename carries the version.

### 4. AI seam: minimal Python interface, stub as default

> **Amended in PR #1 review:** the seam is implemented as an `abc.ABC` with explicit subclassing rather than a `typing.Protocol` — the owner prefers explicit inheritance (see `tasks/lessons.md`). `StubEnricher` lives in its own module (`worker/stub.py`).

The worker defines an `Enricher` interface with one method: extracted content + user context in, contract-valid enrichment result out. `StubEnricher` is the default implementation: deterministic output derived from the content hash (same input → identical result), schema-valid, zero network. Selection via `ENRICHER=stub` env var. No Bedrock client, no retry wrapper, no provider registry — the seam is one interface and one env var; the real implementation arrives in the enrichment change.

### 5. Health checks: HTTP for the API, command probe for the worker

API: `GET /health` returns `200` with `{status, db}` after a `SELECT 1` round-trip; this is its Compose healthcheck. Worker: it serves no HTTP, and adding a port just for health would be false surface — its Compose healthcheck runs `python -m worker.healthcheck`, which verifies DB connectivity in-process. Both containers report healthy in `docker compose ps` as the acceptance signal.

### 6. Tooling: Biome (TS) and ruff (Python), one command each

Alternatives: ESLint + Prettier (two tools, config sprawl) — Biome does both jobs with one config. Python: ruff handles lint + format; pytest for tests; uv for dependency management (fast, lockfile-based). Each workspace exposes the same three verbs: `format`, `lint`, `test`.

### 7. CI: per-workspace jobs plus a Compose smoke job

Three GitHub Actions jobs: `api` (Biome check + Vitest), `worker` (ruff check + pytest), and `stack` (build images, `docker compose up -d --wait`, assert all services healthy, run migrations check). The stack job proves the merge gate — "one command starts a healthy local stack" — on every push, not just on a laptop.

### 8. Schema content: core tables now, mechanics later

Migrations create `links`, `enrichment_jobs`, `enrichments`, `content_versions`, and `idempotency_keys` with the columns, enums, and constraints the build spec defines (including the `(link_id, content_hash, prompt_version)` unique key on enrichments and job lease fields). Creating tables now costs nothing and lets the next change start on behavior instead of DDL. No triggers, no seed data.

## Risks / Trade-offs

- [JSON Schema is less expressive than Zod/Pydantic for cross-field rules] → Acceptable for v1; cross-field invariants (e.g., `revisit` requires reason + date) are enforced by validation code in the worker and covered by shared fixtures.
- [Without a full conformance matrix, the two validators could interpret the schema differently] → Boundary validation plus shared fixtures catches the likely divergences; a complete cross-language conformance suite is deferred until the contract grows enough to warrant it.
- [dbmate adds a third toolchain binary] → Confined to Docker and CI; developers never install it locally unless they author migrations.
- [Compose smoke job lengthens CI] → Image builds are cached via GitHub Actions cache; job is parallel to unit-test jobs, so wall-clock impact is bounded.
- [Schema created before the behavior that uses it] → Columns follow the build spec exactly; if the processing change needs alterations, migrations are cheap while there is no production data.
- [Worker healthcheck passes while main loop is broken] → Acceptable for MVP 1: the loop does nothing yet. The processing change extends the healthcheck (e.g., heartbeat timestamp) when there is a loop worth watching.

## Migration Plan

Greenfield — nothing to migrate or roll back. Merge lands the stack; verification is `docker compose up` plus green CI.

## Open Questions

None blocking. Node version (24 LTS) and Python version (3.12) pinned in Dockerfiles and CI; changing either later is a one-line edit.
