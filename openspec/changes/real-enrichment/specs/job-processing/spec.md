# job-processing Specification (delta)

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Enrichment runs outside database transactions
The worker SHALL NOT hold an open database transaction while fetching the page or running the enricher. The claim transaction commits before fetching starts; content-version storage, result persistence, and status write-back each happen in their own short transactions.

#### Scenario: No transaction held during slow work
- **WHEN** the worker processes a claimed job
- **THEN** the worker holds no open database transaction while fetching the URL or while the enricher runs

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

### Requirement: Processing configuration via environment
Poll interval, lease duration, maximum attempts, fetch limits (redirects, size, duration, content types, host allowlist), enricher selection, and Bedrock settings (model ID, region) SHALL be configurable via environment variables with working defaults documented in `.env.example` and wired through Docker Compose. Defaults SHALL keep the stub as the enricher and let the local stack enrich a saved link without any configuration edits or cloud credentials.

#### Scenario: Defaults work out of the box
- **WHEN** the stack starts from an unedited `.env.example`
- **THEN** the worker polls, claims, fetches, and completes jobs using the default configuration with the stub enricher and no AWS credentials

#### Scenario: Bedrock is opt-in via environment only
- **WHEN** `ENRICHER=bedrock` and AWS settings are provided via environment
- **THEN** the worker uses the Bedrock enricher without any code change

## REMOVED Requirements

### Requirement: Stub enrichment over stand-in content
**Reason**: Stand-in content (URL as content, `sha256(url)` hash, null `content_version_id`) is replaced by the real fetch → extract → store → enrich pipeline; the stub now enriches real extracted text like any other enricher.
**Migration**: Existing stand-in `enrichments` rows keep their URL-derived `content_hash` and null `content_version_id`; new processing writes rows hashed over extracted text with a non-null `content_version_id`, so the unique key never collides between the two generations.
