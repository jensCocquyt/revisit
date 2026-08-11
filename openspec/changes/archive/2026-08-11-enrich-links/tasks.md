# Tasks: enrich-links

## 1. Configuration and test harness

- [x] 1.1 Add `poll_seconds` (default 2), `lease_seconds` (default 60), `max_attempts` (default 3), and `worker_id` (`{hostname}-{pid}`) to `worker/config.py`; remove `heartbeat_seconds`; update `tests/test_config.py`
- [x] 1.2 Update `.env.example` and `docker-compose.yml`: add `WORKER_POLL_SECONDS`, `WORKER_LEASE_SECONDS`, `WORKER_MAX_ATTEMPTS` with defaults; retire `WORKER_HEARTBEAT_SECONDS`
- [x] 1.3 Add integration-test scaffolding: fixture reading `DATABASE_URL` (fail loudly when unset), connection fixture, SQL helpers to insert a link + pending job and clean up per test

## 2. Claiming and leasing

- [x] 2.1 Implement `claim_one` in `worker/jobs.py`: single `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)` claim statement per design, own short transaction, returns claimed job (id, link_id, attempts) or None
- [x] 2.2 Integration tests: eligible pending job claimed with `processing` status, future lease, and `locked_by`; future `available_at` not claimed; empty table claims nothing
- [x] 2.3 Integration tests for exclusivity and recovery: uncommitted claim on connection A blocks connection B (SKIP LOCKED); expired lease is reclaimed with refreshed lease; unexpired lease is not reclaimed

## 3. Processing and success write-back

- [x] 3.1 Implement `process_one` in `worker/jobs.py`: load link fields, build `EnrichmentInput` with URL as stand-in content, run injected enricher outside any transaction, compute `content_hash = sha256(url)`, define `PROMPT_VERSION = "stub-v1"`
- [x] 3.2 Implement success write-back: one transaction with `ON CONFLICT DO NOTHING` enrichment insert (null `content_version_id`), `locked_by`-guarded job update to `completed` + `completed_at`, link update to `enriched` only when the guard matched
- [x] 3.3 Integration tests: processed job stores a contract-valid enrichment row (validate with `validate_json`), job completed, link enriched; repeated processing of the same job leaves exactly one enrichments row and still completes; stale claimant (lease reassigned) skips write-back

## 4. Failure handling

- [x] 4.1 Implement transient-failure write-back: guarded update incrementing `attempts`, setting `last_error` (stable code + truncated safe detail), status back to `pending`, `available_at = now() + min(5 * 2**attempts, 60)` seconds, lease cleared
- [x] 4.2 Implement terminal failure: when the failing attempt is the last allowed, mark job `failed` and link `failed` with `last_error`, same transaction
- [x] 4.3 Integration tests using a raising fake `Enricher`: first failure reschedules with attempts+1, future `available_at`, `last_error` set; delays non-decreasing and capped; third failure leaves job and link `failed`

## 5. Poll loop and logging

- [x] 5.1 Replace the heartbeat loop in `worker/__main__.py`: connect, build enricher via `get_enricher`, loop claim → process, sleep `poll_seconds` only when nothing was claimed; single-line JSON logs with `job_id` and `link_id` for claim, completion, failure, and reschedule events
- [x] 5.2 Run the full worker suite plus `ruff format` / `ruff check`; verify the stub remains the default path with no `DATABASE_URL`-independent tests broken

## 6. CI and stack verification

- [x] 6.1 CI worker job: add the PostgreSQL service container and dbmate migration step mirroring the api job
- [x] 6.2 CI stack job: after health checks, POST a link with an `Idempotency-Key` and poll `GET /links/:id` until `status` is `enriched` (bounded ~60s timeout, fail otherwise)
- [x] 6.3 End-to-end local verification: `docker compose up --build` from `.env.example`, save a link, observe it reach `enriched`; confirm formatting, linting, and both test suites pass
