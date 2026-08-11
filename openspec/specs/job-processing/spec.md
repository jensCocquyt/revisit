# job-processing Specification

## Purpose
The worker's enrichment-job lifecycle: polling and claiming with `FOR UPDATE SKIP LOCKED` and a processing lease, stale-lease recovery, enrichment through the `Enricher` seam over stand-in content, idempotent result persistence, bounded-backoff retries with terminal failure, status write-back visible through `GET /links/:id`, and the configuration and logging around all of it.

## Requirements
### Requirement: Claim one eligible job with a lease
The worker SHALL poll for eligible enrichment jobs and claim at most one per iteration inside a short transaction using `FOR UPDATE SKIP LOCKED`. A job is eligible when its status is `pending` and `available_at <= now()`. Claiming SHALL set status to `processing`, `locked_until` to now plus the configured lease duration, and `locked_by` to the worker's instance identifier, and SHALL commit before any enrichment work begins. Only one worker may hold a valid lease for a job at a time.

#### Scenario: Pending job is claimed
- **GIVEN** an enrichment job with status `pending` and `available_at` in the past
- **WHEN** the worker polls
- **THEN** the job's status becomes `processing` with `locked_until` in the future and `locked_by` set
- **AND** the claim transaction is committed before enrichment starts

#### Scenario: Concurrent claimers never take the same job
- **GIVEN** exactly one eligible job
- **WHEN** two workers attempt to claim concurrently
- **THEN** exactly one worker claims the job and the other claims nothing

#### Scenario: Future-scheduled job is not claimed
- **GIVEN** a `pending` job whose `available_at` is in the future
- **WHEN** the worker polls
- **THEN** the job is not claimed and remains `pending`

#### Scenario: Nothing to claim
- **GIVEN** no eligible jobs
- **WHEN** the worker polls
- **THEN** no job changes state and the worker waits the configured poll interval before polling again

### Requirement: Expired leases are reclaimable
A job with status `processing` whose `locked_until` has passed SHALL be eligible for claiming again, so that a job held by a crashed or killed worker is recovered. A `processing` job whose lease has not expired SHALL NOT be claimable.

#### Scenario: Killed worker's job is reclaimed
- **GIVEN** a job in `processing` whose `locked_until` has passed because its worker died mid-processing
- **WHEN** another worker polls
- **THEN** that worker claims the job, refreshing `locked_until` and `locked_by`

#### Scenario: Valid lease blocks reclaim
- **GIVEN** a job in `processing` whose `locked_until` is still in the future
- **WHEN** another worker polls
- **THEN** the job is not claimed

### Requirement: Enrichment runs outside database transactions
The worker SHALL NOT hold an open database transaction while running the enricher. The claim transaction commits before enrichment starts, and result persistence plus status write-back happen in a separate short transaction afterwards.

#### Scenario: No transaction held during enrichment
- **WHEN** the worker processes a claimed job
- **THEN** the worker holds no open database transaction between committing the claim and beginning the write-back

### Requirement: Stub enrichment over stand-in content
Until real fetching lands, the worker SHALL use the link's URL as the enrichment content, passing it through the `Enricher` seam together with the link's note and goal. The stored enrichment SHALL carry a `content_hash` derived from that stand-in content, a null `content_version_id`, and a contract-valid result. No network access or model credentials SHALL be required when the stub enricher is configured.

#### Scenario: Stub result is stored and contract-valid
- **GIVEN** a saved link and the `stub` enricher configured with no API key present
- **WHEN** its job is processed
- **THEN** an `enrichments` row exists for the link with a contract-valid result, a `content_hash` derived from the URL, and a null `content_version_id`

### Requirement: Idempotent result persistence
Processing is at least once; persistence MUST be idempotent. The worker SHALL persist results relying on the unique key `(link_id, content_hash, prompt_version)`: when a row for that key already exists, the insert conflict SHALL be treated as success and processing SHALL continue to status write-back.

#### Scenario: Repeated processing yields exactly one row
- **GIVEN** a job whose result was already persisted
- **WHEN** the same job is processed again (e.g. after a lease expiry mid-write-back)
- **THEN** exactly one `enrichments` row exists for `(link_id, content_hash, prompt_version)`
- **AND** the job still reaches `completed`

### Requirement: Success write-back
On successful enrichment the worker SHALL, in one short transaction, mark the job `completed` with `completed_at` set and mark the link `enriched`. The new link status SHALL be visible through `GET /links/:id`.

#### Scenario: Save, poll, enriched
- **GIVEN** a link saved via `POST /links`
- **WHEN** the worker processes its job successfully
- **THEN** the job is `completed` with `completed_at` set
- **AND** `GET /links/:id` returns `status: "enriched"`

### Requirement: Transient failures retry with bounded backoff
When enrichment fails with a retryable error and the attempt count is below the configured maximum, the worker SHALL increment `attempts`, record `last_error` as a stable error code plus safe diagnostic detail, set status back to `pending`, and set `available_at` using bounded exponential backoff so later attempts wait longer, up to a cap.

#### Scenario: First transient failure reschedules
- **GIVEN** a claimed job whose enrichment fails with a transient error
- **WHEN** the worker handles the failure
- **THEN** the job returns to `pending` with `attempts` incremented, `last_error` set, and `available_at` in the future

#### Scenario: Backoff grows and is bounded
- **WHEN** the same job fails transiently on consecutive attempts
- **THEN** each reschedule delay is at least the previous one and never exceeds the configured cap

### Requirement: Terminal failure after max attempts
When a transient failure occurs on the final allowed attempt (3 by default), the worker SHALL mark the job `failed` with `last_error` set and mark the link `failed` in the same write-back transaction. Failed jobs SHALL remain in the table for later manual requeue.

#### Scenario: Third failure is terminal
- **GIVEN** a job that has already failed twice
- **WHEN** its third processing attempt fails transiently
- **THEN** the job is `failed` with `last_error` set
- **AND** `GET /links/:id` returns `status: "failed"`

### Requirement: Processing configuration via environment
Poll interval, lease duration, and maximum attempts SHALL be configurable via environment variables with working defaults documented in `.env.example` and wired through Docker Compose. Defaults SHALL let the local stack enrich a saved link without any configuration edits.

#### Scenario: Defaults work out of the box
- **WHEN** the stack starts from an unedited `.env.example`
- **THEN** the worker polls, claims, and completes jobs using the default poll interval, lease duration, and max attempts

### Requirement: Structured processing logs
The worker SHALL log job lifecycle events (claim, completion, failure, reschedule) as single-line JSON including `link_id` and `job_id`.

#### Scenario: Lifecycle events are attributable
- **WHEN** a job is claimed and completed
- **THEN** the worker emits single-line JSON log entries for each event containing that job's `job_id` and `link_id`
