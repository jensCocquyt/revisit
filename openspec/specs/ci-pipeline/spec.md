# ci-pipeline Specification

## Purpose
TBD - created by archiving change project-foundation. Update Purpose after archive.
## Requirements
### Requirement: Single-command quality gates per workspace
Each workspace SHALL expose single commands for formatting check, linting, and unit tests that run locally without Docker or external services.

#### Scenario: API checks run locally
- **WHEN** a developer runs the API workspace's format, lint, and test commands on a clean checkout
- **THEN** each command completes successfully without network credentials or a running database

#### Scenario: Worker checks run locally
- **WHEN** a developer runs the worker workspace's format, lint, and test commands on a clean checkout
- **THEN** each command completes successfully without network credentials or a running database

### Requirement: CI runs on every pull request and on pushes to main
GitHub Actions SHALL run formatting checks, linting, and unit tests for both workspaces on every pull request and on every push to `main`. Each workflow run SHALL be checked once: a newer commit on the same ref supersedes an in-progress run.

#### Scenario: Green build on clean code
- **WHEN** a commit with passing checks lands on a pull request or `main`
- **THEN** the CI workflow completes successfully

#### Scenario: Violations fail the build
- **WHEN** a commit containing a formatting violation, lint error, or failing unit test lands on a pull request or `main`
- **THEN** the CI workflow fails and reports which check failed

### Requirement: Worker integration tests run against PostgreSQL in CI
The CI worker job SHALL provide a PostgreSQL service container with migrations applied before running the worker test suite, so integration tests covering job claiming, retries, and persistence run on every pull request and push to `main`. Integration tests SHALL fail loudly when `DATABASE_URL` is unset rather than silently skipping.

#### Scenario: Worker integration tests run in CI
- **WHEN** the CI worker job runs
- **THEN** migrations are applied to a PostgreSQL service container and the worker test suite, including database integration tests, passes against it

#### Scenario: Missing database fails loudly
- **WHEN** the worker integration tests run without `DATABASE_URL` set
- **THEN** they fail with a clear message instead of being skipped

### Requirement: CI verifies the local stack
CI SHALL build the service images, start the full Docker Compose stack, and verify that migrations apply and all services report healthy. The stack job SHALL run only after both per-workspace check jobs succeed. The stack job SHALL additionally prove the end-to-end enrichment path: submit a link through the API and poll its retrieval endpoint until the link reports `enriched`, within a bounded timeout.

#### Scenario: Stack smoke test passes
- **WHEN** the CI stack job runs on a healthy commit
- **THEN** all Compose services reach a healthy state and the job succeeds

#### Scenario: Broken stack fails CI
- **WHEN** a commit prevents a service from becoming healthy or a migration from applying
- **THEN** the stack job fails

#### Scenario: End-to-end enrichment succeeds in the stack
- **WHEN** the stack job POSTs a link and polls `GET /links/:id`
- **THEN** the link reaches `status: "enriched"` before the timeout and the job succeeds

#### Scenario: Broken enrichment path fails CI
- **WHEN** a commit prevents saved links from reaching `enriched` in the running stack
- **THEN** the stack job fails at the end-to-end check

### Requirement: CI runs the stub eval offline and gates on provable measures
The merge-gating CI workflow SHALL run the evaluation command with the stub enricher and gate on schema validity and evidence resolution rate being 100%. Accuracy measures SHALL be reported but never gate. The merge-gating workflow SHALL remain fully offline and credential-free: no live network fetches, no AWS credentials, eval inputs are committed snapshots.

#### Scenario: Eval gate passes on a healthy stub
- **WHEN** CI runs on a commit where the stub produces contract-valid results with fully resolvable evidence for every eval case
- **THEN** the eval step passes

#### Scenario: Eval gate fails on a provable regression
- **WHEN** a commit makes the stub emit contract-invalid output or unresolvable evidence for any eval case
- **THEN** the eval step fails the CI run and the report names the failing measure

#### Scenario: Merge gate needs no credentials
- **WHEN** the CI workflow runs
- **THEN** it completes without AWS credentials and without fetching any live web page

### Requirement: Manual Bedrock eval workflow
A separate GitHub Actions workflow SHALL run the evaluation against Bedrock on `workflow_dispatch` only — no schedule, and never a required status check. It SHALL authenticate via GitHub OIDC by assuming an AWS IAM role scoped to `bedrock:InvokeModel`, with the role ARN read from a repository variable; long-lived AWS keys SHALL NOT be stored in the repository. The workflow SHALL fail fast with a clear message when the role variable is unset, and on success SHALL publish the full five-measure report as both a job summary and an uploaded artifact. The AWS-side OIDC provider and role creation SHALL be documented as a manual prerequisite.

#### Scenario: Dispatch runs the Bedrock eval and publishes the report
- **GIVEN** the OIDC prerequisite is set up and the role variable is configured
- **WHEN** the workflow is dispatched manually
- **THEN** it assumes the role via OIDC, runs the eval with `ENRICHER=bedrock`, and publishes the full report as a job summary and artifact

#### Scenario: Missing role variable fails fast
- **GIVEN** the role ARN repository variable is unset
- **WHEN** the workflow is dispatched
- **THEN** it fails immediately with a message explaining the missing prerequisite and pointing at the setup documentation

#### Scenario: Decoupled from the merge gate
- **WHEN** the Bedrock eval workflow fails or is never run
- **THEN** pull requests are unaffected and the merge-gating CI workflow's behavior is unchanged

