# Proof and Resilience — Design

## Context

The full pipeline exists and is tested: claim with `FOR UPDATE SKIP LOCKED` + lease (`worker/jobs.py`), safe fetch, extraction, content versioning, enrichment through the `Enricher` seam, evidence verification (`worker/evidence.py`), idempotent persistence, and bounded-backoff retries. `tests/test_jobs_int.py` already covers claiming, lease expiry/reclaim, stale-claim write-back skip on success, duplicate processing, transient/terminal failures, and backoff. What's missing is proof of analysis *quality* (the build-spec's five measures), a tested recovery path for `failed` jobs, and failure log events that can be counted.

## Goals / Non-Goals

**Goals:**

- An offline, labelled eval set runnable as `python -m worker.evals` against any configured enricher, reporting the five build-spec measures.
- CI gates on the two measures the stub can prove (schema validity, evidence resolution) and stays byte-for-byte offline.
- A dispatch-only GitHub Actions workflow that runs the same eval against Bedrock via OIDC and publishes the full report.
- A test-verified SQL requeue procedure in `docs/runbook.md`.
- Failure/reschedule log events carry attempt number and error code.
- Resilience test gaps closed (audit first, then fill).

**Non-Goals:**

- No eval framework or generic harness — a module, fixtures, and a table.
- No scheduled eval runs, no CloudWatch/dashboards, no DLQ/admin API, no prompt tuning.
- No contract shape changes, no API changes, no Bruno changes.

## Decisions

### 1. Eval set layout: paired files under `apps/worker/evals/`

`apps/worker/evals/fixtures/<name>.html` (stored page snapshot) paired with `<name>.json` (labels: `expected_save_intent`, `expected_recommended_action`, `revisit_justified`, plus optional `note`/`goal` inputs to exercise user context). ~10–15 cases spanning the four `recommended_action` classes, with several `revisit_justified: false` cases so the false-revisit rate is meaningful.

- *Why paired files over one labels.json*: each case is self-contained; adding a case is one pair, no central file to conflict on.
- *Why not `contracts/`*: that directory is the cross-language contract surface and test-time only by convention; the eval set is worker-only.
- *Why not `tests/fixtures/`*: eval fixtures are also read by the Bedrock workflow's eval run, which is not a pytest run; keeping them out of `tests/` keeps that boundary clean. Both CI paths run from the `apps/worker` checkout, so no image changes are needed.

Snapshots are stored HTML committed to the repo — no live fetching, ever. Page content in fixtures remains untrusted data: it flows only through `extract_content` into `EnrichmentInput.content`, same as production.

### 2. Eval pipeline reuses the production seam unchanged

Per case: read snapshot → `extract_content` → `enricher.enrich(EnrichmentInput(...))` → `validation_errors` / `resolve_evidence` → score against labels. No database, no network (stub), no changes to `Enricher`, `EnrichmentInput`, or `EnrichmentOutcome`.

- Schema validity: an `EnricherError` (e.g. `invalid_model_output`) or any exception marks the case schema-invalid and excludes it from accuracy measures; it must not crash the run — a Bedrock run with one bad output must still produce a report.
- Evidence resolution rate: resolvable evidence items / total emitted evidence items, using `resolve_evidence` against the extracted text (repaired offsets count as resolved; dropped items count as unresolved).
- Save-intent accuracy and recommended-action quality: exact-match rate against labels.
- False-revisit rate: fraction of cases labelled `revisit_justified: false` where the enricher recommends `revisit`.

### 3. Report and gating: markdown to stdout, `--gate` for CI

The command prints a markdown table (five measures + per-case rows) so the workflow can pipe it straight into `$GITHUB_STEP_SUMMARY` and attach it as an artifact. Default exit code is 0 (report-only). With `--gate`, exit 1 unless schema validity and evidence resolution rate are both 100%. Accuracy measures never gate — they are meaningless for the stub and advisory for Bedrock.

- *Why a flag instead of always gating*: the same command serves local Bedrock exploration (report-only) and CI (gating) without two code paths.
- Determinism: the stub derives output from a SHA-256 of its input, and cases are processed in sorted filename order, so byte-identical report output on repeated stub runs is guaranteed and asserted in a test.

### 4. Requeue runbook: SQL blocks extracted and executed by the test

`docs/runbook.md` documents inspection SQL (find failed jobs, read `last_error` by `link_id`/`job_id`) and requeue SQL (status → `pending`, `available_at = now()`, `attempts = 0`, `last_error = NULL`, lease columns cleared; link status back to `pending`). The integration test parses the fenced SQL block labelled `-- runbook:requeue` out of the markdown and executes it verbatim: terminally fail a job, run the extracted SQL, assert the job is claimable and processes to completion.

- *Why extract from the doc instead of duplicating the SQL in the test*: duplication is exactly how runbooks rot; executing the documented text is the only guarantee the doc works.
- *`attempts` resets to 0* (documented in the runbook): a manual requeue is an operator judgment that the underlying cause is fixed; the job deserves a full retry budget. Preserving attempts would make the first transient hiccup terminal.

### 5. Metrics: two fields on existing log events, nothing else

`job failed` and `job rescheduled` events gain `attempt` (the attempt number just recorded) and `error_code` (the stable prefix of `last_error` before the first `:`). Failure is then countable and groupable from logs alone. No new events, no metrics libraries.

### 6. Bedrock eval workflow: dispatch-only, OIDC, fail-fast

`.github/workflows/eval.yml`: `on: workflow_dispatch` only, `permissions: id-token: write, contents: read`, never referenced by branch protection. First step fails with a clear message if `vars.AWS_EVAL_ROLE_ARN` is unset. Then `aws-actions/configure-aws-credentials` assumes the role (scoped to `bedrock:InvokeModel`), `uv sync`, run the eval with `ENRICHER=bedrock`, append the report to the job summary, and upload it as an artifact. The AWS-side setup (OIDC provider, role + trust policy restricted to this repo, `bedrock:InvokeModel`-only policy) is a documented manual prerequisite in the runbook.

- *Why OIDC over repo-secret keys*: no long-lived credentials to leak or rotate; the trust policy pins the repo.
- *Why a separate workflow instead of a job in ci.yml*: the merge gate must remain provably offline and credential-free — separation makes that auditable at a glance ("ci.yml never touches AWS").

### 7. Resilience gap-fill: audit is a task, not an assumption

Existing coverage is strong (see Context). The audit step in tasks confirms what remains; expected gaps, from reading the current suite:

- Requeue-after-failure end to end (failed → runbook SQL → reprocessed → link `enriched`) — the requeue test from Decision 4 covers this.
- A *stale* worker taking the failure path: lease expires mid-processing, job reclaimed, then the stale worker's `_fail` write-back is skipped (only the success-path stale skip is tested today).
- Crash after enrichment persistence but before status write-back is observable: reclaimed job's reprocessing completes through the `ON CONFLICT DO NOTHING` path and still reaches `completed`/`enriched` (partially covered by `test_stale_claimant_skips_write_back`; make the crash-shaped variant explicit if the audit confirms it differs).

## Risks / Trade-offs

- [Stub cannot prove accuracy measures] → gate only schema validity and evidence resolution; report the rest. Accuracy is judged from manually triggered Bedrock runs.
- [Eval labels encode one person's judgment] → keep the set small and the labels reviewable in the PR; findings recorded, not auto-acted-on.
- [Report-from-doc SQL extraction is unusual] → keep the marker convention trivial (`-- runbook:requeue` in a fenced block) and fail the test loudly if the marker is missing.
- [Bedrock eval costs money on every dispatch] → manual trigger only; small fixture set bounds cost per run.
- [OIDC setup is manual and easy to get subtly wrong] → runbook documents exact trust policy including the repo condition; workflow fails fast with a message pointing at the runbook when the role variable is unset.
- [Markdown report format could drift from what gating parses] → gating reads the computed measures in-process, never parses its own output.

## Open Questions

None — decisions above resolve the ones raised in the proposal (attempts reset: yes; fixture location: `apps/worker/evals/`; gating mechanism: `--gate` flag).
