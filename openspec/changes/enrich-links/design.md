# Design: enrich-links

## Context

The schema already carries everything the queue needs (`enrichment_jobs` with `available_at`, `locked_until`, `locked_by`, `attempts`, `last_error`; `enrichments` with the `(link_id, content_hash, prompt_version)` unique key). The `Enricher` seam and deterministic `StubEnricher` exist. `psycopg` is already a worker dependency (used by `worker/healthcheck.py`). This change is purely worker-side wiring plus tests and CI: no migrations, no API code, no contract changes.

## Goals / Non-Goals

**Goals**: claim → enrich → persist → write-back loop; single-claimer leasing; stale-lease recovery; bounded-backoff retries; terminal failure at max attempts; offline end-to-end via the stub.

**Non-Goals**: URL fetching, extraction, SSRF guards, real models, evidence verification, `content_versions` writes, requeue tooling, metrics, any generic job framework.

## Decisions

### 1. Claim query: one `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)` statement

```sql
UPDATE enrichment_jobs
SET status = 'processing',
    locked_until = now() + make_interval(secs => %(lease)s),
    locked_by = %(worker_id)s,
    updated_at = now()
WHERE id = (
  SELECT id FROM enrichment_jobs
  WHERE (status = 'pending' AND available_at <= now())
     OR (status = 'processing' AND locked_until <= now())
  ORDER BY available_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING id, link_id, attempts;
```

Run in its own short transaction (commit immediately). `SKIP LOCKED` makes concurrent claimers pass over a row another transaction holds, so two workers can never claim the same job; the lease (`locked_until`) extends that exclusivity across the commit boundary while the claimant works. The stale-lease branch (`processing AND locked_until <= now()`) makes a dead worker's job claimable again with no separate reaper process.

The claim joins `links` afterwards (separate plain SELECT, no transaction needed) to fetch `url`, `note`, `goal`. Alternative considered: join inside the claim statement — rejected to keep the locked statement minimal.

The existing `(status, available_at)` index serves the `pending` branch; the expired-lease branch scans the (tiny) `processing` set. At MVP scale that is fine; a partial index is deferred until measured.

`worker_id` is `{hostname}-{pid}` — unique enough to attribute leases in logs, no coordination needed.

### 2. Transaction boundaries: claim tx → no tx during enrich → one write-back tx

- **Claim** (short tx): the statement above, committed before anything else.
- **Enrich** (no tx): build `EnrichmentInput`, call the enricher. The connection holds no open transaction here (autocommit mode; explicit `with conn.transaction()` blocks only around claim and write-back).
- **Write-back** (short tx), on success, all in one transaction:
  1. `INSERT INTO enrichments (...) ON CONFLICT (link_id, content_hash, prompt_version) DO NOTHING` — a conflict is success (at-least-once processing, idempotent persistence).
  2. `UPDATE enrichment_jobs SET status='completed', completed_at=now(), locked_until=NULL, locked_by=NULL ... WHERE id=%s AND locked_by=%s AND status='processing'` — guarded by our own claim.
  3. `UPDATE links SET status='enriched' ...` — only if step 2 updated a row.

The `locked_by` guard on step 2 handles the losing side of a lease-expiry race: if our lease expired mid-enrichment and another worker reclaimed the job, we skip status write-back entirely (log and move on) — the current claimant owns the outcome, and our enrichment insert was idempotent anyway. This is the simplest fencing that preserves "only one worker holds a valid lease": no fencing tokens, no version columns.

Failure write-back is a single guarded `UPDATE` of the job (plus the link update in the terminal case), same transaction shape.

### 3. Stand-in content: the link URL

PR 3 introduces fetching and extraction. Until then `EnrichmentInput.content` is the link's URL string, `content_hash = sha256(url)` (hex), and `content_version_id` stays NULL (the column is already nullable; `content_versions` is untouched). This exercises the real persistence path — including the idempotency key, since the hash is stable per link — without inventing placeholder content. When PR 3 lands, only the content-sourcing step changes; hash derivation and persistence stay as-is.

`prompt_version` is a worker constant, `"stub-v1"` for this change: there is no prompt yet, but the column is NOT NULL and part of the idempotency key, so the value must be stable and must change when a future real prompt changes.

### 4. Retry math: fixed-base exponential backoff, code constants

`delay = min(BASE * 2**attempts, CAP)` with `BASE = 5s`, `CAP = 60s`, computed from the attempt count *before* increment — failures reschedule at 5s, 10s, 20s (never reached: terminal at 3). Base and cap are code constants, not env vars: only poll interval, lease duration, and max attempts earn configuration (they matter for tests, local runs, and the stack); backoff shape does not vary by environment at MVP scale.

On transient failure with `attempts + 1 < max`: `attempts = attempts + 1`, `status = 'pending'`, `available_at = now() + delay`, `last_error = '<code>: <detail>'`, lease cleared. On the final attempt: job `failed`, link `failed`, `last_error` set, same transaction.

`last_error` format: stable code prefix (`enrich_error`, and later fetch codes in PR 3) plus a truncated exception summary — safe detail, no stack traces or content.

All failures are treated as transient in this change: the stub cannot fail terminally, and the terminal-failure taxonomy (blocked destinations, content types, size limits) belongs to PR 3's fetch path.

### 5. Configuration

New in `worker/config.py`, `.env.example`, and Compose:

| Variable | Default | Purpose |
|---|---|---|
| `WORKER_POLL_SECONDS` | `2` | Sleep between empty polls (claims chain immediately while work exists) |
| `WORKER_LEASE_SECONDS` | `60` | Lease duration written at claim |
| `WORKER_MAX_ATTEMPTS` | `3` | Terminal-failure threshold |

`WORKER_HEARTBEAT_SECONDS` is retired along with the heartbeat loop (removed from `config.py`, `.env.example`, and Compose). The Compose healthcheck already uses `worker.healthcheck` (database reachability) and is unaffected.

### 6. Module layout and testability

- `worker/jobs.py`: `claim_one(conn, ...)`, `process_one(conn, job, enricher, ...)`, backoff/write-back helpers. Pure orchestration over an injected connection and enricher — integration tests call these directly.
- `worker/__main__.py`: opens the connection, builds the enricher via `get_enricher`, loops `claim → process`, sleeps `WORKER_POLL_SECONDS` when nothing was claimed. Stays thin; not unit-tested beyond startup behavior.

Tests force failures by passing a raising `Enricher` fake into `process_one` — the `ENRICHER` env selection and stub default stay untouched (config invariant: the stub remains the default test path).

### 7. Integration test harness

`tests/test_jobs_int.py` (name mirrors the API's `*.int.test.ts` convention in spirit): a pytest fixture reads `DATABASE_URL` and **fails** (not skips) when unset, matching the API suite's behavior. Fixtures create a link + job via plain SQL and clean up per-test (delete in FK order). Key cases map 1:1 to the spec scenarios:

- claim marks processing + lease; future `available_at` not claimed
- SKIP LOCKED: hold an uncommitted claim in connection A, poll from connection B → B gets nothing (deterministic, no threads)
- expired lease reclaimed (backdate `locked_until` with SQL); valid lease not reclaimed
- success write-back: enrichments row contract-valid, job completed, link enriched
- repeated processing → exactly one enrichments row
- transient failure → pending, attempts+1, `available_at` in future, `last_error` set; delays non-decreasing and capped
- third failure → job failed, link failed
- `locked_by` guard: reclaimed job's stale claimant skips write-back

CI worker job gains the same postgres service + dbmate migration step as the api job. The stack job gains a step that POSTs a link (curl) and polls `GET /links/:id` until `enriched` with a ~60s timeout.

## Risks / Trade-offs

- [Two claimants after lease expiry both run the model] → acceptable by design: at-least-once processing; persistence idempotent; `locked_by` guard keeps status write-back single-writer.
- [Expired-lease branch has no dedicated index] → `processing` rows are few at MVP scale; revisit with measurement, per config rule against speculative infrastructure.
- [URL-as-content bakes a stand-in into `content_hash` values] → rows created before PR 3 will re-enrich under real content hashes; harmless (new hash → new idempotency key), and MVP data is disposable.
- [Poll default of 2s adds idle query load] → one cheap indexed query every 2s; negligible, and it keeps the stack demo and CI end-to-end check fast.

## Migration Plan

Ship as one PR. No schema or API changes; rollback is redeploying the previous worker image (jobs simply stop being consumed again). Jobs left `processing` by a rollback mid-flight recover via lease expiry once a consuming worker returns.

## Open Questions

None — scope, invariants, and defaults were fixed by the change request; deviations recorded above (backoff constants in code, `prompt_version = "stub-v1"`).
