# operational-recovery Specification

## Purpose
The documented, test-verified procedure for recovering failed enrichment jobs: inspection SQL to find failures and read `last_error`, and requeue SQL that restores a failed job to a claimable state. Recovery is deliberately SQL-only — no DLQ service, no admin API.

## Requirements
### Requirement: Runbook documents failure inspection
`docs/runbook.md` SHALL document SQL to inspect failed enrichment jobs: listing jobs with status `failed`, and looking up a specific job's `last_error`, `attempts`, and timestamps by `link_id` or `job_id`.

#### Scenario: Operator finds why a link failed
- **GIVEN** a link whose enrichment terminally failed
- **WHEN** an operator follows the runbook's inspection SQL with the link's id
- **THEN** they obtain the job's `last_error` code and detail and its attempt count

### Requirement: Documented requeue restores a job to a claimable state
The runbook SHALL document requeue SQL that resets a failed job to `pending`, clears `locked_until` and `locked_by`, sets `available_at` to now, resets `attempts` to 0, clears `last_error`, and resets the link status so the pipeline can process it again. The runbook SHALL state that `attempts` resets to 0 and why (a manual requeue grants a fresh retry budget). Recovery SHALL remain SQL-only: no DLQ service, no admin API.

#### Scenario: Requeued job is processed to completion
- **GIVEN** a job with status `failed` whose underlying cause is fixed
- **WHEN** the requeue SQL is executed and a worker polls
- **THEN** the worker claims the job with a full retry budget and processes it, and on success the link becomes `enriched`

### Requirement: Runbook requeue SQL is verified by a test
An integration test SHALL extract the requeue SQL verbatim from `docs/runbook.md` (via a stable marker) and execute it against a terminally failed job, asserting the job becomes claimable and processes to completion. The test SHALL fail loudly if the marker or SQL block is missing.

#### Scenario: Doc and behavior cannot drift
- **WHEN** the requeue SQL in the runbook is edited in a way that breaks recovery
- **THEN** the integration test executing the documented SQL fails

#### Scenario: Missing marker fails the test
- **WHEN** the marked requeue SQL block is removed from the runbook
- **THEN** the test fails with a message naming the missing marker
