## ADDED Requirements

### Requirement: Single-command quality gates per workspace
Each workspace SHALL expose single commands for formatting check, linting, and unit tests that run locally without Docker or external services.

#### Scenario: API checks run locally
- **WHEN** a developer runs the API workspace's format, lint, and test commands on a clean checkout
- **THEN** each command completes successfully without network credentials or a running database

#### Scenario: Worker checks run locally
- **WHEN** a developer runs the worker workspace's format, lint, and test commands on a clean checkout
- **THEN** each command completes successfully without network credentials or a running database

### Requirement: CI runs on every push and pull request
GitHub Actions SHALL run formatting checks, linting, and unit tests for both workspaces on every push and pull request to `main`.

#### Scenario: Green build on clean code
- **WHEN** a commit with passing checks is pushed
- **THEN** the CI workflow completes successfully

#### Scenario: Violations fail the build
- **WHEN** a commit containing a formatting violation, lint error, or failing unit test is pushed
- **THEN** the CI workflow fails and reports which check failed

### Requirement: CI verifies the local stack
CI SHALL build the service images, start the full Docker Compose stack, and verify that migrations apply and all services report healthy.

#### Scenario: Stack smoke test passes
- **WHEN** the CI stack job runs on a healthy commit
- **THEN** all Compose services reach a healthy state and the job succeeds

#### Scenario: Broken stack fails CI
- **WHEN** a commit prevents a service from becoming healthy or a migration from applying
- **THEN** the stack job fails
