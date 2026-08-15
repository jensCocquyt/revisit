# job-processing Specification

## Purpose
The worker's enrichment-job lifecycle: polling and claiming with `FOR UPDATE SKIP LOCKED` and a processing lease, stale-lease recovery, the full processing pipeline (safe fetch, extraction, content versioning, enrichment through the `Enricher` seam, evidence verification), idempotent result persistence, terminal-vs-transient failure handling with bounded-backoff retries, status write-back visible through `GET /links/:id`, and the configuration and logging around all of it.

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
The worker SHALL NOT hold an open database transaction while fetching the page or running the enricher. The claim transaction commits before fetching starts; content-version storage, result persistence, and status write-back each happen in their own short transactions.

#### Scenario: No transaction held during slow work
- **WHEN** the worker processes a claimed job
- **THEN** the worker holds no open database transaction while fetching the URL or while the enricher runs

### Requirement: Jobs process real page content through the full pipeline
For each claimed job the worker SHALL fetch the link's URL safely, extract readable text, store the content version, run the configured enricher over the extracted text together with the link's note and goal, verify evidence, and persist the result. The stored enrichment SHALL reference the `content_versions` row via `content_version_id`, carry the `content_hash` of the extracted text, and record the enricher's `prompt_version`, `model_id`, and — when the enricher provides them — `latency_ms` and `token_usage`.

#### Scenario: Enrichment references its content version
- **GIVEN** a saved link whose page fetches and extracts successfully
- **WHEN** its job completes
- **THEN** the `enrichments` row has a non-null `content_version_id` pointing at the stored content version, `content_hash` equal to that version's hash, and the enricher's `prompt_version` and `model_id`

#### Scenario: Stub path works offline end to end
- **GIVEN** the `stub` enricher configured and a fetchable page (no model credentials present)
- **WHEN** the job is processed
- **THEN** the link reaches `enriched` with a contract-valid result linked to a real `content_versions` row, without any model network access

### Requirement: Terminal failures fail immediately
Blocked destinations, invalid or unsafe URLs, unsupported content types, size-limit violations, and empty extraction SHALL fail the job and link immediately on the attempt where they occur — regardless of remaining attempts — with `last_error` set to a stable error code plus safe detail. Terminal failures SHALL NOT be rescheduled. Failed jobs remain in the table for manual requeue.

#### Scenario: Blocked destination does not retry
- **GIVEN** a link whose URL targets a blocked address range
- **WHEN** the worker processes its job for the first time
- **THEN** the job is `failed` with a stable blocked-destination code in `last_error`, `available_at` is not rescheduled, and `GET /links/:id` returns `status: "failed"`

#### Scenario: Terminal failure records exactly one attempt
- **GIVEN** a fresh job whose fetch is terminally rejected
- **WHEN** the worker handles the failure
- **THEN** `attempts` is `1` and the job is never claimed again

### Requirement: Evidence is verified against stored content before persistence
Before persisting a result, the worker SHALL verify each evidence item against the stored extracted text: an item resolves only if its quote appears verbatim in the text, and its offsets SHALL be normalized to the verbatim match location. Items whose quote does not appear verbatim SHALL be dropped, not corrected by guesswork. The number of dropped items SHALL be logged. Dropping evidence SHALL NOT by itself fail the enrichment.

#### Scenario: Mismatched offsets are repaired from the verbatim quote
- **GIVEN** an enricher result containing an evidence item whose quote appears in the extracted text but whose offsets point elsewhere
- **WHEN** the worker verifies evidence
- **THEN** the persisted item's offsets identify the verbatim occurrence of the quote in the stored text

#### Scenario: Unresolvable evidence is dropped and counted
- **GIVEN** a result with three evidence items, one of which quotes text not present in the stored content
- **WHEN** the worker verifies evidence
- **THEN** the persisted result contains the two resolvable items, and a log entry records one dropped item

#### Scenario: Persisted evidence resolves exactly
- **WHEN** any enrichment is persisted
- **THEN** every evidence item's `[start_offset, end_offset)` slice of the stored extracted text equals its quote

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
When processing fails with a retryable error — fetch timeouts, connection errors, DNS resolution failures, upstream rate limits and `5xx` responses, model call failures, or contract-invalid model output — and the attempt count is below the configured maximum, the worker SHALL increment `attempts`, record `last_error` as a stable error code plus safe diagnostic detail, set status back to `pending`, and set `available_at` using bounded exponential backoff so later attempts wait longer, up to a cap.

#### Scenario: First transient failure reschedules
- **GIVEN** a claimed job whose fetch times out
- **WHEN** the worker handles the failure
- **THEN** the job returns to `pending` with `attempts` incremented, `last_error` set, and `available_at` in the future

#### Scenario: Invalid model output retries
- **GIVEN** an enricher whose response fails contract validation
- **WHEN** the worker handles the failure
- **THEN** the failure is classified as transient and the job is rescheduled with backoff

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
Poll interval, lease duration, maximum attempts, fetch limits (redirects, size, duration, content types, host allowlist), enricher selection, and Bedrock settings (model ID, region) SHALL be configurable via environment variables with working defaults documented in `.env.example` and wired through Docker Compose. Defaults SHALL keep the stub as the enricher and let the local stack enrich a saved link without any configuration edits or cloud credentials.

#### Scenario: Defaults work out of the box
- **WHEN** the stack starts from an unedited `.env.example`
- **THEN** the worker polls, claims, fetches, and completes jobs using the default configuration with the stub enricher and no AWS credentials

#### Scenario: Bedrock is opt-in via environment only
- **WHEN** `ENRICHER=bedrock` and AWS settings are provided via environment
- **THEN** the worker uses the Bedrock enricher without any code change

### Requirement: Structured processing logs
The worker SHALL log job lifecycle events (claim, completion, failure, reschedule) as single-line JSON including `link_id` and `job_id`. Failure and reschedule events SHALL additionally include the attempt number just recorded and the stable error code (the prefix of `last_error` before its first `:`), so failures are countable and groupable from logs alone.

#### Scenario: Lifecycle events are attributable
- **WHEN** a job is claimed and completed
- **THEN** the worker emits single-line JSON log entries for each event containing that job's `job_id` and `link_id`

#### Scenario: Failure events are countable
- **WHEN** a job attempt fails, whether rescheduled or terminal
- **THEN** the emitted event includes the attempt number and the stable error code alongside `job_id` and `link_id`
