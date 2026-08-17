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
terraform/         AWS demo environment (bootstrap = durable, demo = ephemeral)
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

## Cloud deployment (AWS)

The stack runs on AWS as an **ephemeral demo environment**: provision it, run the demo, destroy it. Everything is Terraform; there are no long-lived AWS credentials anywhere (GitHub OIDC for deploys, task roles at runtime, Secrets Manager for the database credentials and API key).

One-time setup (operator credentials): apply `terraform/bootstrap` (state bucket, ECR repositories, deploy role) and set the repository variables `AWS_DEPLOY_ROLE_ARN`, `TF_STATE_BUCKET`, and `BEDROCK_MODEL_ID` — see the runbook's "Bootstrap and deploy role" section.

Deploy: dispatch the **Deploy** workflow. It builds and pushes SHA-tagged images, applies `terraform/demo`, runs migrations as a one-off ECS task, waits for stable services, and prints the API URL. The demo walkthrough is [docs/demo.md](docs/demo.md).

Teardown: dispatch **Deploy** with `destroy: true`, or locally:

```bash
cd terraform/demo && terraform destroy
```

### Architecture decisions

- **No NAT gateway.** Tasks run in public subnets with public IPs; security groups do all isolation (worker accepts nothing, API accepts only ALB traffic). Saves ~$35/month over the private-subnets-plus-NAT layout; the trade-off is documented rather than hidden.
- **SG-gated public RDS.** The runbook's recovery path is `psql`, so RDS is publicly resolvable but accepts 5432 only from the task security groups and one operator CIDR. A production setup would use private subnets and a bastion; this is a personal, ephemeral demo database.
- **ALB, HTTP only.** The load balancer provides the stable demo URL. HTTPS needs a domain and certificate — out of scope; the API key rides a header on a throwaway environment and rotates on every provision.
- **Task role vs execution role.** The execution role is ECS's own identity (pull image, write logs, fetch secrets); the task role is what application code gets. The worker's task role is `bedrock:InvokeModel` only; the API has no task role at all.
- **Deploy role is service-scoped, not action-scoped.** Honest scoping (IAM path, state bucket) instead of pretend least-action precision; no long-lived keys anywhere.
- **Two TLS dialects in one secret.** node-postgres and libpq disagree about `sslmode` semantics against RDS's private CA, so the database secret holds a `node` and a `libpq` connection string. Encrypted but unverified TLS — a production setup would pin the RDS CA bundle.

Estimated cost while running: **≈ $55/month** (≈ $0.08/hour — ALB ~$19, two 0.25-vCPU Fargate tasks ~$18, db.t4g.micro RDS ~$15, secrets and logs ~$2). The durable bootstrap resources are pennies. The environment is meant to be destroyed between demos.

## CI

GitHub Actions runs four jobs on every push: `api` (Biome + Vitest), `worker` (ruff + pytest), `stack` (full Compose stack builds, becomes healthy, and the stub enricher produces a contract-valid result inside the container), and `terraform` (offline format check and validate — the merge gate never touches AWS). Deploys and the Bedrock eval are separate, never-required workflows.
