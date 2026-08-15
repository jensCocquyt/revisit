# enrichment-evals Specification (delta)

## ADDED Requirements

### Requirement: Labelled offline evaluation set
The repository SHALL contain a labelled evaluation set of stored HTML page snapshots (approximately 10–15 cases) under `apps/worker/evals/fixtures/`. Each case SHALL pair a snapshot file with a label file recording the expected `save_intent`, the expected `recommended_action`, and whether a revisit is justified, and MAY include `note` and `goal` inputs. The set SHALL span all four `recommended_action` classes and SHALL include multiple cases where a revisit is not justified. Snapshots are committed files; the eval SHALL never fetch from the network. Snapshot content SHALL be treated as untrusted data, flowing only through the production extraction path.

#### Scenario: Cases are self-contained pairs
- **WHEN** a new evaluation case is added
- **THEN** it consists of one snapshot file and one label file and requires no edits to any central registry

#### Scenario: No network access
- **WHEN** the eval runs with the stub enricher
- **THEN** it completes with no network access of any kind

### Requirement: Eval command runs the configured enricher
`python -m worker.evals` SHALL run every case in the evaluation set through the production pipeline seam — extraction, enrichment via the enricher selected by `ENRICHER` (stub by default, Bedrock via `ENRICHER=bedrock`), contract validation, and evidence resolution — without modifying the `Enricher` seam contract and without a database.

#### Scenario: Stub by default
- **WHEN** `python -m worker.evals` runs with no `ENRICHER` set
- **THEN** all cases are evaluated with the stub enricher

#### Scenario: Bedrock via environment
- **WHEN** `python -m worker.evals` runs with `ENRICHER=bedrock` and AWS settings configured
- **THEN** all cases are evaluated through the Bedrock enricher with no code change

#### Scenario: A failing case does not abort the run
- **GIVEN** an enricher that raises or returns contract-invalid output for one case
- **WHEN** the eval runs
- **THEN** that case is recorded as schema-invalid, excluded from accuracy measures, and the remaining cases still run and the report is still produced

### Requirement: Five-measure report
The eval SHALL report the five build-spec measures: schema validity rate, save-intent accuracy, recommended-action accuracy, false-revisit rate (fraction of cases labelled not-revisit-justified where the enricher recommends `revisit`), and evidence resolution rate (resolvable evidence items over total emitted evidence items, where offset-repaired items count as resolved and dropped items as unresolved). The report SHALL be printed to stdout as a markdown table including per-case results.

#### Scenario: Report covers all five measures
- **WHEN** the eval completes
- **THEN** stdout contains a markdown report with all five measures and a per-case breakdown

### Requirement: Deterministic report for the stub
With the stub enricher, repeated runs over the same evaluation set SHALL produce byte-identical report output.

#### Scenario: Repeated stub runs match
- **WHEN** `python -m worker.evals` runs twice with the stub enricher and an unchanged evaluation set
- **THEN** both runs print byte-identical output

### Requirement: Gating exit code
By default the eval SHALL exit 0 after printing the report. With `--gate`, it SHALL exit non-zero unless schema validity and evidence resolution rate are both 100%. Accuracy measures SHALL never affect the exit code.

#### Scenario: Gate passes on a clean stub run
- **WHEN** `python -m worker.evals --gate` runs with the stub enricher
- **THEN** the exit code is 0

#### Scenario: Gate fails on an unresolvable-evidence result
- **GIVEN** an enricher result containing evidence that does not resolve against the extracted text
- **WHEN** the eval runs with `--gate`
- **THEN** the exit code is non-zero and the report identifies the failing measure

#### Scenario: Accuracy never gates
- **GIVEN** a run where accuracy measures are below 100% but schema validity and evidence resolution are 100%
- **WHEN** the eval runs with `--gate`
- **THEN** the exit code is 0
