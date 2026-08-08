# dev-stack Specification

## Purpose
TBD - created by archiving change project-foundation. Update Purpose after archive.
## Requirements
### Requirement: One-command local stack
The system SHALL start PostgreSQL, the API, and the worker with a single `docker compose up` invocation, without requiring any external API keys or cloud credentials.

#### Scenario: Fresh start succeeds
- **WHEN** a developer runs `docker compose up` on a clean checkout with only a `.env` file copied from `.env.example`
- **THEN** PostgreSQL, the API, and the worker containers start and all reach a healthy state

#### Scenario: No external credentials required
- **WHEN** the stack is started with no cloud or model provider credentials configured
- **THEN** every service becomes healthy and no service logs an authentication error

### Requirement: API health check
The API SHALL expose a `GET /health` endpoint that reports service and database connectivity status.

#### Scenario: Healthy API
- **WHEN** `GET /health` is requested while the database is reachable
- **THEN** the API responds `200` with a body indicating the service and database are healthy

#### Scenario: Database unreachable
- **WHEN** `GET /health` is requested while the database is not reachable
- **THEN** the API responds with a non-200 status indicating the database check failed

### Requirement: Worker health check
The worker SHALL provide a health probe that verifies the worker process can reach the database, and the Compose configuration SHALL use it as the container healthcheck.

#### Scenario: Healthy worker
- **WHEN** the worker healthcheck runs while the database is reachable
- **THEN** it exits successfully and the container reports healthy

#### Scenario: Worker cannot reach database
- **WHEN** the worker healthcheck runs while the database is not reachable
- **THEN** it exits with a non-zero status and the container reports unhealthy

### Requirement: Environment configuration via documented variables
All service configuration SHALL come from environment variables, and `.env.example` SHALL list every variable the stack reads with a working local default or a placeholder.

#### Scenario: Example file is sufficient
- **WHEN** a developer copies `.env.example` to `.env` without edits
- **THEN** the local stack starts and becomes healthy using those values

#### Scenario: Startup ordering respects dependencies
- **WHEN** the stack starts from cold
- **THEN** the API and worker only begin serving after PostgreSQL is healthy and migrations have completed successfully

