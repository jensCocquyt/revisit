# Proof and Resilience

## Why

The pipeline is fully built — capture, claim, fetch, extract, enrich, verify evidence, persist — but nothing proves the analysis meets the build-spec quality measures, and a failed job today can only be recovered by hand-crafted SQL nobody has written down or tested. This is build-spec PR 4: failures must be reproducible, visible, and recoverable before deployment work starts.

## What Changes

- **Labelled evaluation set**: ~10–15 stored HTML page snapshots as offline fixtures, each labelled with expected `save_intent`, expected `recommended_action`, and whether a revisit is justified. `python -m worker.evals` runs the configured enricher (stub by default, Bedrock via `ENRICHER=bedrock`) over the set and prints a report covering the five build-spec measures: schema validity, save-intent accuracy, recommended-action quality, false-revisit rate, evidence resolution rate. Output is deterministic for the stub.
- **Eval gate in CI**: the existing offline CI runs the eval with the stub and gates only on what the stub can prove — schema validity 100% and evidence resolution rate 100%. Accuracy measures are reported, not gated.
- **Resilience test gap-fill**: existing coverage already proves duplicate processing, retries, terminal failures, stale-claim write-back skip, and API request replay; add what is missing — expired-lease reclaim while a worker is mid-processing, crash between enrichment persistence and status write-back (job reclaimed, conflict path completes it), and requeue-after-failure.
- **Requeue runbook**: `docs/runbook.md` with the SQL to inspect failed jobs (`last_error` by link/job id) and requeue them (reset to pending, clear lease columns, reset `available_at`, reset `attempts` to 0). The requeue SQL is exercised by an integration test so the runbook cannot rot.
- **Log-derived metrics**: failure/reschedule lifecycle events gain the minimal fields that make failure countable (attempt number, error code). No metrics infrastructure.
- **Manual Bedrock eval workflow**: a separate `eval.yml`, `workflow_dispatch` only — never scheduled, never a required check. Runs the same eval command with `ENRICHER=bedrock`, publishes the full report as a job summary and artifact. Auth via GitHub OIDC assuming a scoped IAM role (`bedrock:InvokeModel` only); role ARN from a repo variable; fails fast with a clear message when the variable is unset. AWS-side OIDC provider/role setup is a documented manual prerequisite. The merge-gating CI workflow stays byte-for-byte offline and credential-free.

New infrastructure is limited to the dispatch-only GitHub Actions workflow; it is necessary because a Bedrock eval cannot run in offline CI, and OIDC is the only credential mechanism that avoids long-lived keys in repo secrets.

## Capabilities

### New Capabilities

- `enrichment-evals`: the labelled offline evaluation set, the `python -m worker.evals` command, the five-measure report, and its determinism guarantee for the stub.
- `operational-recovery`: the documented, test-verified procedure to inspect and requeue failed enrichment jobs via SQL.

### Modified Capabilities

- `ci-pipeline`: CI additionally runs the stub eval offline and gates on schema validity and evidence resolution; a separate manual-dispatch workflow runs the Bedrock eval via OIDC and publishes the report.
- `job-processing`: failure and reschedule lifecycle log events additionally carry attempt number and error code so failures are countable from logs.

## Impact

- `apps/worker`: new `worker/evals` module and eval fixtures with labels; small logging-field change in `worker/jobs.py`; new resilience and requeue integration tests.
- `docs/runbook.md`: new (requeue SQL + AWS OIDC prerequisite steps).
- `.github/workflows/ci.yml`: one added offline eval step in the worker job. New `.github/workflows/eval.yml`.
- No contract shape changes, no API surface changes, no Bruno changes, no new services.

## Out of Scope

- Scheduled/nightly eval runs (revisit in the deployment PR once GitHub→AWS OIDC exists for deploys).
- Deployment, CloudWatch, dashboards, or any metrics infrastructure beyond log fields.
- Prompt tuning based on eval results — findings are recorded only.
- Eval of extraction quality itself; embeddings; auth; DLQ service or admin API for recovery.
