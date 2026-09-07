# Deploy and Demo

## Why

The full pipeline works locally and in CI, but the build spec's target environment is AWS and PR 5's merge gate is "provision from zero and complete the full demo against the cloud URL". Nothing cloud exists yet: no Terraform, no deploy workflow, no cloud migration path, no way to see logs or failure counts outside `docker compose logs`. This change closes that gap — and doubles as the deliberate AWS learning vehicle, so it prefers the idiomatic AWS way and documents every architecture decision.

New infrastructure is necessary because this PR *is* the infrastructure PR: the product loop (save → enrich with Bedrock → inspect → recover) cannot be demonstrated end-to-end without a cloud environment running the real model under real IAM.

## What Changes

- **Terraform environment, from zero**: VPC and networking, ECS Fargate services for API and worker (existing images pushed to ECR), RDS PostgreSQL, Secrets Manager for database credentials (injected into tasks, never in task definitions or env files), least-privilege IAM task roles (worker: `bedrock:InvokeModel` only; API: no AWS permissions), CloudWatch log groups, S3 state backend. `terraform destroy` → `terraform apply` must round-trip cleanly — the environment is ephemeral by design.
- **Cost discipline as a design constraint**: smallest viable sizes, no NAT gateway if a defensible network design allows it, estimated monthly cost and the teardown command documented in the README.
- **Minimal endpoint protection**: the API stays public (demo requirement) but must not be an anonymous Bedrock-spend faucet. Cheapest defensible option (static API key header vs security-group allowlist — decided in design). Full auth stays deferred per the build spec.
- **Cloud migrations**: dbmate runs against RDS as a deliberate deploy-flow step (one-off ECS task or workflow step), never a documented laptop-with-tunnel path.
- **Deploy workflow**: `workflow_dispatch` GitHub Actions workflow that builds/pushes images and applies Terraform, assuming a scoped deploy role via the existing GitHub OIDC provider (id-embedded `sub` claim format per the runbook). The merge-gating CI workflow stays offline; at most an offline `terraform fmt`/`validate` job is added.
- **CloudWatch metrics from existing logs**: metric filters over the worker's structured events (`error_code` counts, `deadline dropped`, `evidence dropped`) plus a minimal alarm or dashboard. No metrics code in the app itself, consistent with proof-and-resilience.
- **Scheduled Bedrock eval**: with a deploy role in place, `eval.yml` gains a weekly schedule plus an eval-path trigger. Still never a required check; manual dispatch remains. This deliberately amends the "no schedule" requirement in `ci-pipeline`.
- **Demo assets on contract v2**: a scripted demo against the cloud URL — save real links, show tags and resolvable evidence, one deadline case and one no-deadline case (the v2 analogue of the build spec's stale "`none` and `revisit`" wording), then terminally fail a job and recover it with the runbook requeue against RDS. Bruno gains a cloud environment (the build spec says Postman; this repo standardized on Bruno).

## Capabilities

### New Capabilities

- `cloud-deployment`: the Terraform-provisioned AWS environment — networking, ECS Fargate services, RDS, ECR, Secrets Manager credential injection, least-privilege task roles, log groups, S3 state backend, and the destroy/apply round-trip guarantee.
- `deploy-workflow`: the GitHub Actions deploy path — OIDC-assumed scoped role, image build/push, Terraform apply, and the cloud migration step against RDS.
- `cloud-observability`: CloudWatch metric filters over the worker's existing structured log events and the minimal alarm/dashboard built on them.
- `api-authentication`: the minimal request-protection rule for the public API (key check or allowlist), including what remains unprotected (`/health`) and what stays deferred.
- `cloud-demo`: the scripted v2 demo against the cloud URL and the Bruno cloud environment.

### Modified Capabilities

- `ci-pipeline`: the "Manual Bedrock eval workflow" requirement changes from "no schedule, ever" to "weekly schedule + eval-path trigger, still never a required check"; a new offline `terraform fmt`/`validate` check joins the merge-gating workflow (which otherwise stays offline and credential-free).

## Impact

- **New top-level `terraform/` directory** — the entire environment definition.
- **`.github/workflows/`**: new `deploy.yml`; `eval.yml` gains schedule + path trigger; `ci.yml` gains an offline terraform fmt/validate job only.
- **`apps/api`**: small middleware change if the API-key option wins the design decision (plus 401 behavior in the OpenAPI doc and Bruno collection — the two-way sync test enforces this).
- **`bruno/`**: new `environments/cloud.bru` (the sync test ignores `environments/`, so this is safe).
- **`docs/`**: runbook gains the deploy role + cloud recovery specifics; README gains cloud run instructions, cost estimate, teardown command; a demo script/doc is added; architecture decisions documented for portfolio readability.
- **`.env.example`**: any new variables the services read (e.g. API key, `AWS_REGION` for the worker) — the dev-stack spec requires it to list every variable.
- **AWS account**: new scoped deploy IAM role reusing the existing OIDC provider; ECR repositories; everything else Terraform-managed and ephemeral.

## Out of Scope

- Custom domain, TLS certificates, CloudFront — the demo URL is whatever AWS hands out.
- Multi-user/production authentication, rate limiting beyond the minimal protection above.
- Message broker, object storage, embeddings, frontend (build-spec deferrals unchanged).
- Autoscaling, multi-AZ RDS, blue/green deploys, distributed tracing — this is a personal-account demo environment, not production.
- `GET /links` listing endpoint (build-spec step 8) — not needed for the demo; separate change if wanted.
