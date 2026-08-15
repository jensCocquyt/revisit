# Proof and Resilience — Tasks

## 1. Log-derived metrics

- [x] 1.1 Add `attempt` and `error_code` fields to the `job failed` and `job rescheduled` events in `worker/jobs.py` (error code = `last_error` prefix before the first `:`)
- [x] 1.2 Extend `tests/test_jobs_int.py` failure tests (or add a focused test) asserting the emitted events carry both fields via `caplog`

## 2. Evaluation set and command

- [x] 2.1 Create `apps/worker/evals/fixtures/` with ~10–15 HTML snapshot + label JSON pairs spanning all four `recommended_action` classes, several `revisit_justified: false` cases, and some with `note`/`goal` inputs
- [x] 2.2 Implement `worker/evals` (`python -m worker.evals`): load cases in sorted order, run extract → configured enricher → contract validation → evidence resolution per case, catching per-case failures as schema-invalid
- [x] 2.3 Compute the five measures and print the markdown report (summary table + per-case rows); implement `--gate` (exit non-zero unless schema validity and evidence resolution are 100%; accuracy never gates)
- [x] 2.4 Tests: stub run is byte-identical across two invocations; a fake enricher that raises marks the case schema-invalid without aborting; unresolvable evidence fails `--gate`; sub-100% accuracy with clean schema/evidence passes `--gate`
- [x] 2.5 Run `python -m worker.evals` and `--gate` locally on the stub; confirm the report is correct and deterministic

## 3. CI eval gate (offline)

- [x] 3.1 Add an eval step to the `worker` job in `.github/workflows/ci.yml`: `uv run python -m worker.evals --gate`
- [x] 3.2 Verify ci.yml still contains no AWS references and no live-network fetches (eval inputs are committed snapshots)

## 4. Requeue runbook and recovery test

- [x] 4.1 Write `docs/runbook.md`: inspection SQL (failed jobs list; `last_error`/`attempts` by `link_id`/`job_id`) and requeue SQL in a fenced block marked `-- runbook:requeue` (pending, lease cleared, `available_at = now()`, `attempts = 0`, `last_error` cleared, link status reset), with the attempts-reset rationale
- [x] 4.2 Integration test: extract the marked SQL block from `docs/runbook.md` (fail loudly if the marker is missing), terminally fail a job, execute the extracted SQL, assert the job is claimed with a fresh retry budget and processes to `completed`/`enriched`

## 5. Resilience gap-fill

- [x] 5.1 Audit `tests/test_jobs_int.py` and API replay tests against the failure scenarios in the specs; list confirmed gaps in the PR description
- [x] 5.2 Add the missing tests — expected: stale worker's failure-path write-back is skipped after reclaim; explicit crash-shaped variant of "enrichment persisted, job reclaimed, conflict path completes it" if the audit confirms it differs from existing coverage

## 6. Bedrock eval workflow

- [x] 6.1 Create `.github/workflows/eval.yml`: `workflow_dispatch` only, `id-token: write`; fail fast with a clear message when `vars.AWS_EVAL_ROLE_ARN` is unset; assume role via `aws-actions/configure-aws-credentials`; run the eval with `ENRICHER=bedrock` (no `--gate`); append the report to `$GITHUB_STEP_SUMMARY` and upload it as an artifact
- [x] 6.2 Document the AWS OIDC prerequisite in the runbook: create the GitHub OIDC provider, the role with a trust policy pinned to this repo, and a `bedrock:InvokeModel`-only policy; set the repo variable
- [x] 6.3 After the AWS prerequisite is set up: dispatch the workflow once, confirm it runs green, and attach the published report to the PR

## 7. Verification

- [x] 7.1 Run `uv run ruff format --check .`, `uv run ruff check .`, and the full worker suite (with `DATABASE_URL`) locally
- [x] 7.2 Confirm no changes to `apps/api`, `contracts/`, or `bruno/`; confirm the contract seam (`Enricher`, `EnrichmentInput`, `EnrichmentOutcome`) is unchanged
