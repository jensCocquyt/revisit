# Tasks: deploy-and-demo

## 1. API key middleware (offline, independently testable)

- [x] 1.1 Add API-key middleware to `apps/api`: when `API_KEY` is set, reject link routes lacking a matching `x-api-key` with `401 {"error": "unauthorized"}`; `/health`, `/openapi.json`, `/docs` stay open; unset `API_KEY` installs nothing
- [x] 1.2 Declare the `apiKey` security scheme in the OpenAPI document and document the 401 response on protected routes
- [x] 1.3 Tests: 401 without/with-wrong key, pass-through with key (idempotency intact), open endpoints, unset-key behavior unchanged
- [x] 1.4 Add `API_KEY` (commented, optional) to `.env.example`; add `{{apiKey}}` header var to the Bruno requests and confirm `bruno.test.ts` and the local environment still pass

## 2. Terraform bootstrap root (durable resources)

- [x] 2.1 Write `terraform/bootstrap/`: S3 state bucket (versioned, SSE, private), ECR repositories for api/worker/migrate, deploy IAM role trusting the existing OIDC provider with the id-embedded `sub` claim (runbook format), service-scoped policy with IAM path and state-bucket resource scoping
- [ ] 2.2 Apply bootstrap with operator credentials; set repo variables `AWS_DEPLOY_ROLE_ARN` and `BEDROCK_MODEL_ID`
- [x] 2.3 Document bootstrap in the runbook: what it creates, why it is not ephemeral, the deploy-role scoping decision

## 3. Terraform demo root (ephemeral environment)

- [x] 3.1 Networking: VPC, two public subnets across AZs, internet gateway, route tables; security groups for ALB, API task, worker task, migrate task, RDS (task-SG + operator-CIDR var on 5432); no NAT
- [x] 3.2 RDS PostgreSQL: db.t4g.micro single-AZ gp3, `publicly_accessible` with SG gating, master password via `random_password` → Secrets Manager (`recovery_window_in_days = 0`), full `DATABASE_URL` secret assembled for task injection, `skip_final_snapshot`
- [x] 3.3 ECS: cluster, log groups with retention, execution role (ECR pull, logs, secret read), worker task role (`bedrock:InvokeModel` only), API task with no task-role permissions; task definitions injecting `DATABASE_URL` via `secrets` and setting `ENRICHER=bedrock`, `BEDROCK_MODEL_ID`, `AWS_REGION` for the worker
- [x] 3.4 ALB: HTTP :80 → API :3000, health check `GET /health`, API service registered; outputs for ALB URL and sensitive `api_key`
- [x] 3.5 API key: `random_password` → Secrets Manager → API task env via `secrets`; migrate task definition (dbmate image, same secret)
- [x] 3.6 S3 backend with `use_lockfile` for the demo root; `terraform fmt`/`validate` clean

## 4. Migrate image and CI terraform job (offline)

- [x] 4.1 Add `db/Dockerfile` (dbmate base, `COPY db/migrations`, default `--no-dump-schema up`) and confirm compose migrate parity
- [x] 4.2 Add offline `terraform` job to `ci.yml`: `fmt -check -recursive` + `validate -backend=false` for both roots, no credentials

## 5. Deploy workflow

- [x] 5.1 Write `.github/workflows/deploy.yml`: `workflow_dispatch` with `destroy` input; fail fast without `AWS_DEPLOY_ROLE_ARN`; OIDC assume; build/push three SHA-tagged images; `terraform apply` with image-tag var (or `destroy`)
- [x] 5.2 Migration step: `aws ecs run-task` for the migrate task, wait for exit 0, fail the run otherwise; then wait for services stable and print the ALB URL
- [x] 5.3 Verify `ci.yml` diff contains only the offline terraform job (merge gate otherwise byte-for-byte unchanged)

## 6. Observability

- [x] 6.1 Metric filters in the demo root: `job failed` (dimension `error_code`), `deadline dropped`, `evidence dropped` over the worker log group
- [x] 6.2 Dashboard (failures by error code, drop counts, log widgets for both services) and one no-action alarm on failed-job count

## 7. Scheduled eval

- [x] 7.1 Update `eval.yml`: weekly cron + push-to-`main` path filter for eval-relevant paths; non-dispatch runs use `vars.BEDROCK_MODEL_ID` and default region, dispatch inputs override; update the header comment that says "never scheduled"
- [x] 7.2 Confirm it remains a non-required check and update the runbook's eval section

## 8. Provision and demo (merge gate)

- [ ] 8.1 Dispatch deploy from zero (bootstrap-only account) and verify: healthy `/health` via ALB URL, migrations applied, worker enriching with Bedrock via task role
- [x] 8.2 Write `scripts/demo-cloud.sh` (BASE_URL + API_KEY params): save deadline-bearing and evergreen links, poll to `enriched`, print tags/evidence/deadline contrast; terminal-failure link, show `failed` + CloudWatch `error_code`, runbook requeue via psql against RDS, show recovery
- [ ] 8.3 Add `bruno/environments/cloud.bru` (`baseUrl`, `apiKey`) and run the collection against the cloud
- [ ] 8.4 Run the full demo script against the cloud URL end to end; verify dashboard and alarm show the induced failure
- [ ] 8.5 Verify the round trip: `destroy` → `apply` → abbreviated smoke (health + one enrichment) with no manual cleanup

## 9. Documentation

- [x] 9.1 README: cloud run instructions, architecture decisions (no-NAT trade-off, SG-gated RDS, ALB, deploy-role scoping, task vs execution role), estimated monthly cost, teardown command
- [x] 9.2 Demo walkthrough doc mapping each script step to what it proves (v2 deadline contrast replacing the build spec's stale `none`/`revisit` wording)
- [x] 9.3 Runbook: cloud recovery specifics (psql to RDS, where to find `DATABASE_URL`), Bedrock Marketplace first-invoke note cross-referenced for the worker task role
