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

