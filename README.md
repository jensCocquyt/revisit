# Revisit

Save a link, understand why it matters, decide what should happen next.

A TypeScript API and a Python enrichment worker share one PostgreSQL database. Links are captured through the API, processed asynchronously by the worker, and enriched into a grounded analysis: what the page is, why it was saved, and whether it should be ignored, read soon, acted on, or revisited later. See [docs/build-spec.md](docs/build-spec.md) for the full MVP 1 build specification.

## Layout

```text
apps/api/          TypeScript Hono API
apps/worker/       Python enrichment worker
contracts/         shared contract fixtures (cross-language conformance suite)
db/migrations/     plain SQL migrations (dbmate)
docker-compose.yml local development stack
```

## Prerequisites

- Docker (with Compose v2)
- Node.js 24 and npm (API development — matches CI and Docker)
- [uv](https://docs.astral.sh/uv/) (worker development)

## Run the stack

```bash
cp .env.example .env
docker compose up --build
```

This starts PostgreSQL, applies migrations, and runs the API and worker. No external API keys are required — the deterministic stub enricher is the default.

- API health: `curl http://localhost:3000/health`
- Service status: `docker compose ps` (all services report healthy)

## Development commands

API (`apps/api`):

```bash
npm install
npm run format   # Biome, writes fixes
npm run lint     # Biome CI mode: format check + lint
npm test         # Vitest
```

Worker (`apps/worker`):

```bash
uv sync
uv run ruff format .      # writes fixes
uv run ruff check .       # lint
uv run pytest             # tests
```

Database migrations live in `db/migrations` and run automatically in Compose. To run them manually against `DATABASE_URL` from `.env`:

```bash
docker run --rm --network host -v ./db:/db -e DATABASE_URL ghcr.io/amacneil/dbmate:2 --no-dump-schema up
```

## Enrichment contract

The enrichment result contract is defined natively in each language: a Zod schema in `apps/api/src/contract.ts` and pydantic models in `apps/worker/worker/contract.py`. The worker validates results it produces; the API validates results it serves. The shared fixtures in `contracts/enrichment/fixtures/` are the cross-language conformance suite — both test suites glob them and assert the verdict encoded in the filename (`valid-*` accepted, `invalid-*` rejected). Changing a contract rule means changing both definitions and the boundary fixtures in the same commit.

## CI

GitHub Actions runs three jobs on every push: `api` (Biome + Vitest), `worker` (ruff + pytest), and `stack` (full Compose stack builds, becomes healthy, and the stub enricher produces a contract-valid result inside the container).
