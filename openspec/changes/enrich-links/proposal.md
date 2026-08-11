# Proposal: enrich-links

## Why

Saved links never leave `pending`: the archived `save-links` change creates exactly one enrichment job per link, but the worker is still an idle heartbeat loop and nothing consumes the queue. This change completes the second half of build-spec PR 2 so that save → poll → enrich works end to end offline with the deterministic stub.

## What Changes

- Replace the worker's idle heartbeat loop with a poll loop that claims one eligible enrichment job per iteration using `FOR UPDATE SKIP LOCKED` and a processing lease (`locked_until` / `locked_by`), committing the claim before doing any work.
- Eligible jobs are `pending` with `available_at <= now()`, or `processing` with an expired lease (stale-lease recovery after a worker dies).
- Run the existing `StubEnricher` through the `Enricher` seam. Until real fetching lands (PR 3), the link's URL is the stand-in content; `content_hash` is derived from it and `content_version_id` stays null.
- Persist the result to `enrichments` relying on the existing unique key `(link_id, content_hash, prompt_version)`; a duplicate insert is success, not an error (at-least-once processing, idempotent persistence).
- Write status back in one short transaction: on success, job `completed` + `completed_at` and link `enriched`; on transient failure, increment `attempts`, set `last_error` (stable code + safe detail), and reschedule via `available_at` with bounded exponential backoff; after 3 attempts, job and link become `failed`.
- Poll interval, lease seconds, and max attempts configurable via env vars with sane defaults in `.env.example` and Compose.
- Worker gains pytest integration tests against real PostgreSQL (claim semantics, concurrent claimers, lease reclaim, backoff, terminal failure, idempotent persistence, status write-back).
- CI: the worker job gains a PostgreSQL service container plus migrations (mirroring the api job); the stack job additionally POSTs a link and polls `GET /links/:id` until `enriched`.

**Explicitly out of scope**

- Fetching the URL, SSRF guards, content extraction (PR 3).
- Bedrock or any real model; evidence verification (PR 3).
- API changes beyond the status naturally changing — no new endpoints, so the Bruno collection is untouched (its sync test guards routes).
- `content_versions` writes, embeddings, brokers, object storage.
- Requeue runbook/admin tooling and full failure-matrix tests (PR 4).
- Metrics beyond the existing single-line JSON logging.

No new infrastructure: PostgreSQL remains the queue, as the build spec's "why no broker" section prescribes.

## Capabilities

### New Capabilities

- `job-processing`: the worker's claim/lease/process/retry lifecycle — polling, single-claimer leasing via `FOR UPDATE SKIP LOCKED`, stale-lease recovery, stub enrichment over stand-in content, idempotent result persistence, bounded-backoff retries, terminal failure after max attempts, and status write-back visible through `GET /links/:id`.

### Modified Capabilities

- `ci-pipeline`: the worker check job runs integration tests against a PostgreSQL service container with migrations applied; the stack job proves the end-to-end save → enrich path, not just service health.

## Impact

- `apps/worker/worker/__main__.py`: heartbeat loop replaced by the poll loop.
- New worker modules for job claiming/processing (e.g. `worker/jobs.py`), plus `worker/config.py` gains poll/lease/attempt settings.
- `apps/worker/tests/`: new integration tests requiring `DATABASE_URL` (fail loudly when unset, like the API's `*.int.test.ts`).
- `.env.example`, `docker-compose.yml`: new worker env vars with defaults; heartbeat setting retired.
- `.github/workflows/ci.yml`: worker job gains the postgres service + migration step; stack job gains the end-to-end check.
- No API code changes, no migrations (schema already has all lease/retry columns), no contract or fixture changes.
