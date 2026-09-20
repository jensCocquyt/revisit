# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Revisit: save a link, get a grounded analysis of what it is and why it matters, tagged for filtering (closed-world assignment against the library's vocabulary) and, when the page ties its value to a concrete date, carrying an evidence-backed `deadline`. A TypeScript Hono API and a Python enrichment worker share one PostgreSQL database; the `enrichment_jobs` table *is* the queue (no broker). Original MVP 1 specification: `docs/build-spec.md` (its v1 intent/action taxonomy was replaced by contract v2, see `openspec/specs/enrichment-contract/`).

**Built so far: the full pipeline.** The API serves `GET /health`, `POST /links`, `GET /links`, `GET /links/:id`, `GET /links/:id/enrichment`, plus `/openapi.json` and Swagger UI at `/docs`; `bruno/` and the OpenAPI document are the authoritative shape. Writes are idempotent via the `Idempotency-Key` header, reads serve only evidence that resolves against stored page text, and cross-origin access is opt-in through `CORS_ORIGINS`. The worker claims jobs with `FOR UPDATE SKIP LOCKED` + lease, safely fetches and extracts pages, enriches through the `Enricher` seam (stub default, Bedrock opt-in), verifies evidence, and persists idempotently.

## Commands

There is **no root `package.json` and no workspace tooling**. Every command runs from `apps/api` or `apps/worker` (CI mirrors this with `working-directory`). API is Node 24; worker is Python 3.12 + uv.

```bash
# apps/api
npm run dev | build | format          # tsx watch | tsc -> dist/ | Biome, writes fixes
npm run lint                          # biome ci . , check only, fails on unformatted code
npm test                              # vitest run, needs DATABASE_URL (see below)

# apps/worker
uv sync
uv run ruff format --check .          # what CI runs; drop --check to write fixes
uv run ruff check .
uv run pytest
```

`npm test` includes integration tests against real PostgreSQL (`*.int.test.ts`); they fail loudly if `DATABASE_URL` is unset. Start the database first:

```bash
docker compose up -d postgres migrate
DATABASE_URL='postgres://revisit:revisit@localhost:5432/revisit?sslmode=disable' npm test
```

Stack, and migrations (dbmate, applied automatically by the `migrate` compose service):

```bash
cp .env.example .env
docker compose up --build             # postgres -> migrate -> api + worker, all healthchecked
docker run --rm --network host -v ./db:/db -e DATABASE_URL ghcr.io/amacneil/dbmate:2 --no-dump-schema up
```

Known local gotcha: `docker compose build` fails under the Docker Desktop version used here; build images with `docker build` directly if needed. The compose build path is verified in CI.

## Architecture

### The contract is the seam, defined twice on purpose

The enrichment result contract is defined **natively in each language**: a Zod v4 discriminated union in `apps/api/src/contract.ts` and pydantic v2 models in `worker/contract.py`. There is deliberately **no shared schema file** (a JSON Schema existed and was removed, see `openspec/changes/contract-native-types/`). Any change to the contract shape must touch **both definitions and the fixtures together**.

Parity rules both definitions follow: strict/`extra="forbid"` objects everywhere; identical length limits and required fields; `deadline` is **complete or absent** (`date`, `reason`, `source` all required within it; explicit `null` also accepted, fixture-pinned); tags are trimmed, lowercase, unique. The worker validates in **JSON mode** (`validate_json`) precisely so its semantics match Zod's (date strings accepted, no scalar coercion). Don't switch it to python-mode validation.

### Shared fixtures ARE the cross-language contract

`contracts/enrichment/fixtures/` is the only artifact keeping the two definitions in agreement. Both test suites glob it and dispatch on filename prefix: `valid-*.json` must validate, `invalid-*.json` must not, so adding a correctly named fixture adds test cases in both languages automatically. **A contract rule without a fixture exercising it can silently diverge between the languages**; when adding or changing a constraint, add the boundary fixtures (at-limit valid, over-limit invalid) in the same commit.

The `contracts/` directory is **test-time only**: runtime images don't contain it, and nothing outside the test suites may read from it.

### AI seam

`worker/enrichers/` holds the seam and its implementations, all re-exported from `worker.enrichers`. `base.py` defines `Enricher` (an abstract base class; the owner prefers ABCs over `Protocol` for explicitness), the `EnrichmentInput`/`EnrichmentOutcome` dataclasses, and the `get_enricher` factory. `stub.py` derives a deterministic contract-valid result from a SHA-256 of `(content, note, goal)`, returning pydantic model instances, not dicts. Model-backed enrichers subclass `ModelEnricher` (`model.py`), which owns the prompt, the contract schema with field guidance, the content cap, tag normalization, strict validation, timing, and error classification; a provider subclass implements only `_complete(system, user, schema)` and returns the JSON payload plus token counts. `bedrock.py` (forced tool call via Converse) and `ollama.py` (local `/api/chat`, local testing only) are the two transports.

Rules that are not visible from the code: selected by the `ENRICHER` env var, default `stub`, and the stub stays the default test path. Each provider's `prompt_version` is `<provider>-<PROMPT_VERSION>`; bump `PROMPT_VERSION` in `model.py` whenever the shared prompt changes. New providers subclass `ModelEnricher` in their own module. Failure-taxonomy errors (`FetchTerminalError`, `FetchTransientError`, `EnricherError`) live together in `worker/errors.py`.

The `worker` package deliberately mixes pipeline modules with runnable entry points (`__main__`, `healthcheck`, `smoke`, `evals`). Don't move the tools out: `healthcheck` and `smoke` must run inside the runtime image (compose healthcheck, CI stack job), and `python -m worker.<tool>` requires living in the package. If the tool set grows, group them into a `worker/cli/` subpackage, still inside the package.

### Database

`db/migrations/*.sql`, dbmate format (`-- migrate:up` / `-- migrate:down`), timestamp-prefixed, run with `--no-dump-schema` so there is **no generated `schema.sql`**; read the migration files. Core tables: `links`, `enrichment_jobs` (lease columns `available_at` / `locked_until` / `locked_by`, `attempts`, `last_error`), `content_versions`, `enrichments`, `idempotency_keys`.

Two uniqueness rules encode the correctness model: `enrichments (link_id, content_hash, prompt_version)` makes worker persistence idempotent under at-least-once retries, and `content_versions (link_id, content_hash)` dedupes extracted content.

### Invariants from `openspec/config.yaml`

- Link and enrichment job are created in one database transaction.
- Slow work (network fetch, model call) never runs inside a database transaction; claim in a short transaction with `FOR UPDATE SKIP LOCKED` plus a lease, then release before doing work.
- Processing is at least once; persistence must be idempotent.
- Retried API submissions must not create duplicate links (idempotency key + hash of the normalized request).
- Page content is untrusted data, never instructions.
- Evidence is shown only when it resolves to stored extracted text; unresolvable evidence is dropped, not guessed.

## Process: OpenSpec

This project is spec-driven via OpenSpec (`openspec/config.yaml`, skills under `.claude/skills/`, commands under `.claude/commands/opsx/`). Work is proposed as a change under `openspec/changes/<change-id>/` containing `proposal.md`, `design.md`, `tasks.md`, and `specs/<capability>/spec.md` (Given/When/Then, `## ADDED Requirements`). Archiving moves the change to `openspec/changes/archive/YYYY-MM-DD-<change-id>/` and prompts to sync its delta specs into `openspec/specs/<capability>/spec.md` (the durable specs). Authoring rules live in `openspec/config.yaml`; read it rather than relying on a restatement here.

Scope rule, which applies to code review too: build only what MVP 1 uses. Brokers, object storage, embeddings, and auth are deliberately deferred.

### Review loop

`.github/workflows/claude-review.yml` reviews every non-draft PR push: findings land as inline comments labelled `blocking` / `should` / `nit`, and one status comment (body starts with `<!-- claude-review-status -->`) records the last reviewed head so re-reviews cover only new commits. `/address-review` (`.claude/commands/address-review.md`) works through the resulting threads locally. The reviewer enforces `tasks/lessons.md`, so record owner corrections there rather than in the prompt.

## Conventions

- Biome for the API: 2-space indent, 100-col lines, organize-imports on. `noUnusedVariables` is explicitly enabled, because Biome's recommended set alone did not catch it and CI proved that.
- Ruff for the worker: 100-col lines, `E,F,W,I,UP,B,SIM`.
- TypeScript is `strict` with `module: NodeNext`, so relative imports need the `.js` extension even in `.ts` source.
- Logs are single-line JSON on both sides.
- CI (`.github/workflows/ci.yml`) runs three jobs on every push: `api` (with a PostgreSQL service container for integration tests), `worker`, and `stack` (full Compose stack must reach healthy and the stub must produce a contract-valid result inside the container).
- **The Bruno collection at `bruno/` tracks the API.** It is the manual testing surface (import into Bruno, or `npx @usebruno/cli run --env local` from `bruno/`). Any change that adds, removes, or reshapes an endpoint must update `bruno/` in the same commit, because `apps/api/test/bruno.test.ts` asserts two-way equality between the collection's requests and the OpenAPI document's routes, so drift fails CI.
