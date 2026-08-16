# enrichment-evals Specification (delta)

## MODIFIED Requirements

### Requirement: Labelled offline evaluation set
The repository SHALL contain a labelled evaluation set of stored HTML page snapshots (approximately 10–15 cases) under `apps/worker/evals/fixtures/`. Each case SHALL pair a snapshot file with a label file recording `expected_tags` (the tags a correct enrichment assigns) and `expected_deadline` (an ISO date, or null when no deadline is defensible), and MAY include `note` and `goal` inputs. The set SHALL include multiple cases with a defensible deadline and multiple without. Snapshots are committed files; the eval SHALL never fetch from the network. Snapshot content SHALL be treated as untrusted data, flowing only through the production extraction path.

#### Scenario: Cases are self-contained pairs
- **WHEN** a new evaluation case is added
- **THEN** it consists of one snapshot file and one label file and requires no edits to any central registry

#### Scenario: No network access
- **WHEN** the eval runs with the stub enricher
- **THEN** it completes with no network access of any kind

### Requirement: Five-measure report
The eval SHALL report: schema validity rate; evidence resolution rate (all evidence items including deadline sources; offset-repaired counts as resolved, dropped as unresolved); **false-deadline rate** (fraction of cases labelled `expected_deadline: null` where a deadline was asserted) as the headline quality measure; deadline recall (fraction of cases with an expected date where a deadline was produced); date accuracy (fraction of produced deadlines, on cases with an expected date, whose date matches exactly); and tag precision and recall (set overlap of produced vs expected tags, aggregated over valid cases). The report SHALL be printed to stdout as a markdown table including per-case results.

#### Scenario: Report covers all measures
- **WHEN** the eval completes
- **THEN** stdout contains a markdown report with schema validity, evidence resolution, false-deadline rate, deadline recall, date accuracy, and tag precision/recall, plus a per-case breakdown

#### Scenario: False deadlines are counted
- **GIVEN** a case labelled `expected_deadline: null` for which the enricher asserts a deadline
- **WHEN** the eval scores the run
- **THEN** the case counts against the false-deadline rate
