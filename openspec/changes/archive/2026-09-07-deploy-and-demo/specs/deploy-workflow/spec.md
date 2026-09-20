# deploy-workflow Delta

## ADDED Requirements

### Requirement: OIDC-authenticated deploy workflow
A `workflow_dispatch` GitHub Actions workflow SHALL build and push the API, worker, and migrate images to ECR tagged with the git SHA, apply the demo Terraform root with that tag, run migrations, and wait for services to stabilize before printing the API URL. It SHALL authenticate by assuming a scoped deploy role via the existing GitHub OIDC provider using the id-embedded `sub` claim format documented in the runbook, with the role ARN read from a repository variable. Long-lived AWS keys SHALL NOT be stored in the repository. The workflow SHALL fail fast with a pointer to the setup documentation when the role variable is unset.

#### Scenario: Dispatch deploys end to end
- **GIVEN** the bootstrap resources exist and the deploy role variable is configured
- **WHEN** the workflow is dispatched
- **THEN** it assumes the role via OIDC, pushes SHA-tagged images, applies Terraform, runs migrations, waits for stable services, and reports the load balancer URL

#### Scenario: Missing role variable fails fast
- **GIVEN** the deploy role repository variable is unset
- **WHEN** the workflow is dispatched
- **THEN** it fails immediately with a message naming the missing prerequisite and the documentation to fix it

#### Scenario: Teardown by dispatch
- **WHEN** the workflow is dispatched with the destroy option
- **THEN** it destroys the stack root instead of applying it, leaving the bootstrap resources intact

### Requirement: Migrations run in-cloud as a deliberate deploy step
Database migrations against RDS SHALL run as a one-off ECS task using a dedicated migrate image (dbmate plus the repository's migration files), invoked by the deploy workflow, which SHALL wait for the task and fail the deploy if migrations exit non-zero. Running migrations from a developer machine over a tunnel SHALL NOT be a documented path.

#### Scenario: Migrations apply during deploy
- **WHEN** the deploy workflow reaches its migration step
- **THEN** the migrate task runs inside the VPC with credentials from Secrets Manager and applies pending migrations before the workflow completes

#### Scenario: Failed migration fails the deploy
- **WHEN** the migrate task exits non-zero
- **THEN** the workflow run fails and reports the migration failure

### Requirement: Deploying never gates merges
The deploy workflow SHALL be dispatch-only and SHALL never be a required status check; the merge-gating CI workflow SHALL NOT gain any step requiring AWS credentials or network access to AWS (its offline Terraform checks are specified in `ci-pipeline`).

#### Scenario: Deploy failures never gate merges
- **WHEN** the deploy workflow fails or is never run
- **THEN** pull request checks are unaffected
