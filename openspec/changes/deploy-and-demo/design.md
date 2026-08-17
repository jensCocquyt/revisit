# Design: deploy-and-demo

## Context

The stack runs locally under Docker Compose and in CI, entirely offline. AWS exists in the repo only as the eval workflow's OIDC role (`AWS_EVAL_ROLE_ARN`, documented in `docs/runbook.md` with the id-embedded `sub` claim format). There is no Terraform, no cloud migration path, no auth on the API, and the worker receives no AWS region configuration. This change builds the cloud environment as PR 5 of the build spec, in a personal AWS account, with the explicit twin goals of (a) passing the merge gate — provision from zero, run the full demo against the cloud URL — and (b) serving as the AWS learning vehicle: idiomatic choices, documented decisions, ephemeral by design.

## Goals / Non-Goals

**Goals:**

- One-command provision from zero and one-command teardown; `destroy` → `apply` round-trips cleanly.
- No long-lived credentials anywhere: OIDC for CI, task roles for runtime, Secrets Manager for the DB password.
- Cost floor: no NAT gateway, smallest viable sizes, documented monthly estimate.
- Logs and log-derived metrics visible in CloudWatch without any app changes.
- A scripted, repeatable demo of the v2 loop against the cloud URL, including failure recovery.

**Non-Goals:**

- Production posture: no multi-AZ, no autoscaling, no custom domain/TLS, no blue-green, no tracing.
- Real authentication or rate limiting (build-spec deferral stands; only the minimal spend-protection below).
- Terraform module abstractions or multi-environment layering — one demo environment, flat files.

## Decisions

### D1. Two Terraform roots: `bootstrap` (durable) and `demo` (ephemeral)

`terraform/bootstrap/` is applied once by a human with their own credentials and holds everything that must survive teardown: the S3 state bucket, the ECR repositories (api, worker, migrate), and the GitHub deploy role + policies (reusing the existing OIDC provider from the eval setup). `terraform/demo/` holds the entire runtime environment and is the thing that round-trips through `destroy`/`apply`.

**Why:** solves the chicken-and-egg (the deploy role can't create the bucket its own state lives in), and keeps images and state out of the blast radius so `destroy` → `apply` needs no image rebuild. Alternative — a single root with `prevent_destroy` lifecycle guards — rejected: it makes `destroy` fail midway instead of cleanly separating durable from ephemeral.

State locking uses S3-native locking (`use_lockfile`), not a DynamoDB table — idiomatic for current Terraform and one less resource. The bootstrap root uses local state, committed as documentation of what it manages (state contains no secrets — the deploy role and bucket names only); if that proves awkward, its state is small enough to re-import.

### D2. Network: public subnets + task public IPs, no NAT; RDS SG-gated

Single VPC, two AZs (ALB and RDS subnet groups require two), public subnets only. Both Fargate tasks run with `assign_public_ip = true`, so they reach ECR, CloudWatch Logs, Secrets Manager, and Bedrock over the internet gateway — no NAT gateway (~$35/month saved), no VPC endpoints (~$22/month for the five needed). Security groups do the isolation: the API task accepts traffic only from the ALB SG; the worker task accepts nothing inbound; RDS accepts 5432 only from the task SGs and from an operator CIDR variable.

RDS is `publicly_accessible = true` but reachable only from the SG-allowlisted operator IP. **Why:** the runbook's recovery procedure is deliberately `psql "$DATABASE_URL"` — the demo's failure-recovery step needs an SQL path to RDS, and an SG-gated public endpoint is the cheapest defensible one (no bastion, no SSM tunnel doc-path, no NAT). Trade-off documented in the README: in a real environment RDS would sit in private subnets; this is a personal, ephemeral, SG-gated demo database holding public web-page analyses.

### D3. ALB in front of the API

An ALB (HTTP :80 → API :3000, health check `GET /health`) provides the stable demo URL. **Why over the cheaper "use the task's public IP":** the task IP changes on every deployment, which breaks "demo against the cloud URL" and the Bruno cloud environment; the ALB is the idiomatic AWS front door and this PR is the learning vehicle — clever shortcuts are explicitly out. HTTPS is out of scope (needs a domain + ACM cert); the API key rides an HTTP header on a throwaway demo environment, and the README says so.

### D4. Endpoint protection: static API key header, enforced only when configured

The API middleware requires `x-api-key` to equal the `API_KEY` env var on all routes except `GET /health` (ALB health checks), `GET /openapi.json`, and `GET /docs` (Swagger UI is the demonstration surface; the key is declared as an OpenAPI `apiKey` security scheme so "Authorize" in Swagger UI works). Missing/wrong key → `401 {"error": "unauthorized"}`. When `API_KEY` is unset, the middleware is not installed — local compose and existing tests stay untouched.

**Why over an SG IP allowlist:** an allowlist would make the "public demo URL" only demoable from one IP and breaks Swagger-UI-from-anywhere; a static key is portable, testable offline, and visible in the Bruno environment. The key is generated by Terraform (`random_password`), stored in Secrets Manager, injected into the API task, and surfaced to the operator via `terraform output -raw api_key` (sensitive). This is spend protection, not auth — the spec says exactly that.

### D5. Migrations: a dedicated migrate image run as a one-off ECS task

A third image (`db/Dockerfile`: `FROM ghcr.io/amacneil/dbmate:2`, `COPY db/migrations /db/migrations`, default command `--no-dump-schema up`) is pushed to ECR alongside api/worker. Terraform defines a `migrate` task definition (same task SG as the services, `DATABASE_URL` injected from Secrets Manager). The deploy workflow invokes it with `aws ecs run-task` and waits for exit code 0 before rolling services.

**Why:** runs in-VPC with the same credential path as everything else, mirrors the compose `migrate` one-shot exactly, and keeps "laptop with a tunnel" out of the documented path. Alternative — dbmate from the GitHub runner over the public RDS endpoint — rejected: it would require opening 5432 to ephemeral runner IPs and abandons the in-VPC idiom.

### D6. Deploy workflow: `deploy.yml`, OIDC, service-scoped deploy role

New `workflow_dispatch`-only `.github/workflows/deploy.yml`: assume the deploy role via OIDC (id-embedded `sub` format from the runbook, pinned to this repo) → build and push the three images to ECR tagged with the git SHA → `terraform apply` on `terraform/demo` with the image tag as a variable → run the migrate task and wait → wait for services stable → print the ALB URL. A separate dispatch input (`destroy: true`) runs `terraform destroy` instead, making teardown a one-click workflow too.

The deploy role's policy is **service-scoped, not action-scoped**: full access to the services Terraform manages (EC2-networking, ECS, ECR, RDS, ELB, Logs, Secrets Manager, `iam:*` restricted to a resource path prefix `/revisit-demo/`, S3 restricted to the state bucket). A true least-action policy for a Terraform apply role is unmaintainable at this scale; the honest, documented trade-off is resource/path scoping plus no long-lived keys. The eval role stays separate and Bedrock-only.

`ci.yml` (merge gate) gains exactly one offline job: `terraform fmt -check -recursive` and `terraform validate` with `-backend=false`. No credentials, byte-for-byte offline otherwise.

### D7. Runtime identity and configuration

- **Worker task role:** `bedrock:InvokeModel` only (same shape as the eval role). Region comes from an `AWS_REGION` env var in the task definition (boto3's standard chain; the code stays untouched). Default region `eu-west-1`, matching the eval workflow's default.
- **API task role:** none (no AWS API calls). Both services still get the standard *execution* role (ECR pull, log write, secret fetch) — task role ≠ execution role, and the distinction is documented as a learning note.
- **DB credentials:** RDS master password generated by Terraform, stored in Secrets Manager, injected via the `secrets` block of the task definitions as `DATABASE_URL` (assembled into the full URL in Secrets Manager, so tasks need no string assembly). Never in task-definition environment, tfvars, or workflow logs.
- **Secrets round-trip:** `recovery_window_in_days = 0` on the secret and `skip_final_snapshot = true` on RDS, so `destroy` → `apply` doesn't collide with soft-deleted resources. Data loss on destroy is the point — ephemeral by design.

### D8. Observability: metric filters over existing log lines, one dashboard, one alarm

The worker already emits single-line JSON (`{"msg": "job failed", ..., "error_code": ...}`), so CloudWatch JSON filter patterns work unmodified:

- `{ $.msg = "job failed" }` → metric `revisit/JobFailed`, dimension `error_code`.
- `{ $.msg = "deadline dropped" }` → `revisit/DeadlineDropped`.
- `{ $.msg = "evidence dropped" }` → `revisit/EvidenceDropped`.

One dashboard (failure counts by error code, drop counts, plus log-insights widgets for both services) and one alarm (JobFailed ≥ 5 in 15 minutes, no action target — visibility, not paging). No app changes, consistent with proof-and-resilience's "logs are the metrics interface" stance.

### D9. Scheduled eval

`eval.yml` gains `schedule` (weekly, Monday 06:00 UTC) and `push` to `main` filtered to eval-relevant paths (`apps/worker/worker/evals*`, `apps/worker/worker/enrichers/**`, eval fixture paths). Non-dispatch runs read `BEDROCK_MODEL_ID` from a repository variable and default the region; dispatch inputs still override. Still never a required check; failures don't gate merges. This amends the `ci-pipeline` requirement that currently says "no schedule" — a deliberate MODIFIED delta now that a deploy role exists and the account is active.

### D10. Demo: script + Bruno cloud environment

`scripts/demo-cloud.sh` (bash, curl + jq, parameterized by `BASE_URL` and `API_KEY`) walks the v2 loop: save two real links (one page whose value is date-bound → deadline present; one evergreen → deadline null), poll to `enriched`, print tags/evidence/deadline with the evidence quotes shown against stored extracted text, then save a link that fails terminally (e.g. an image URL → `unsupported_content_type`), show the `failed` state and CloudWatch-visible `error_code`, run the runbook requeue against RDS via `psql`, and show recovery. `bruno/environments/cloud.bru` adds `baseUrl` + `apiKey` vars; the existing `.bru` requests gain the `x-api-key` header via `{{apiKey}}` (empty locally — the API ignores it when no key is configured; the sync test compares only methods and routes, so this is safe). A demo walkthrough in `docs/` maps each step to what it proves, replacing the build spec's stale "`none` and `revisit`" wording with the v2 deadline-present/absent contrast.

## Risks / Trade-offs

- [Public IPs on Fargate tasks instead of NAT] → SGs allow no inbound to tasks; documented as the deliberate cost trade-off with the NAT/VPC-endpoint alternative priced in the README.
- [SG-gated public RDS] → access limited to task SGs + one operator CIDR; credentials only in Secrets Manager; environment is ephemeral. Documented as a non-production choice.
- [HTTP-only ALB with an API key in a header] → acceptable for a throwaway demo (key rotates with every `apply` since Terraform generates it); README states it plainly.
- [Service-scoped deploy role is broader than least-action] → path/resource scoping where cheap (IAM path prefix, state bucket ARN); no long-lived keys anywhere; honest documentation over pretend precision.
- [First `apply` starts services before the first migration has run] → tasks crash-loop briefly until the workflow's migrate step completes; ECS restarts them and the workflow waits for services-stable afterwards. Accepted for simplicity over orchestration.
- [Bedrock model access / Marketplace first-invoke gotcha resurfaces in the worker] → same runbook workaround already documented for the eval role applies to the worker task role; runbook cross-references it.
- [Terraform-generated API key appears in state] → state bucket is private, SSE-encrypted, in the operator's own account; acceptable for a demo key that guards spend, not data.
- [Weekly eval spends real money] → weekly cadence, one model, small fixed eval set; can be disabled by deleting the schedule block without touching dispatch.

## Migration Plan

1. Human applies `terraform/bootstrap` once (state bucket, ECR, deploy role); sets repo variables (`AWS_DEPLOY_ROLE_ARN`, `BEDROCK_MODEL_ID`).
2. Dispatch `deploy.yml` → images pushed, `terraform/demo` applied, migrations run, services stable, ALB URL printed.
3. Run the demo script against the URL; run the Bruno cloud environment.
4. Teardown: dispatch `deploy.yml` with `destroy: true` (or `terraform destroy` locally). Re-provision at will — merge gate is exactly this round trip.

Rollback = destroy; there is no in-place rollback story for a demo environment.

## Open Questions

- Exact Bedrock model id for the demo (repo variable, not code) — owner picks at deploy time; `eu-west-1` availability constrains the list.
- Operator CIDR for RDS access is a tfvars value the owner supplies per apply; whether to also allow it on the ALB SG (probably not — the API is meant to be publicly demoable).
