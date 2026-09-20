# cloud-demo Delta

## ADDED Requirements

### Requirement: Scripted demo exercises the v2 loop against the cloud URL
A committed, parameterized demo script SHALL run the full contract-v2 product loop against the cloud URL: save real links with the API key, poll to `enriched`, and display tags, evidence that resolves to stored extracted text, one enrichment with a `deadline` and one with `deadline: null` (the v2 replacement for the build spec's v1 "`none` and `revisit`" contrast). A demo walkthrough document SHALL map each step to what it proves.

#### Scenario: Deadline contrast is demonstrated
- **WHEN** the demo script runs against a provisioned environment
- **THEN** it shows at least one enrichment whose `deadline` carries `date`, `reason`, and evidence-backed `source`, and one whose `deadline` is absent or null

#### Scenario: Evidence shown is resolvable
- **WHEN** the demo displays evidence quotes
- **THEN** each quote resolves to the stored extracted text for that link (dropped evidence is absent, not fabricated)

### Requirement: Demo includes terminal failure and runbook recovery
The demo SHALL terminally fail one job (a URL the fetcher rejects with a stable `error_code`), show the failed state via the API and the `error_code` in CloudWatch, then recover it using the runbook's requeue procedure executed against RDS, and show the link subsequently reach `enriched`.

#### Scenario: Failure is observable
- **WHEN** the demo saves a link that fails terminally
- **THEN** the link reports `failed` via the API and the worker's `job failed` event with its `error_code` is visible in CloudWatch

#### Scenario: Requeue recovers the job
- **GIVEN** a terminally failed job in RDS
- **WHEN** the runbook requeue is executed against the cloud database (scoped or full, per the runbook)
- **THEN** the job reprocesses and the link reaches a terminal state again, demonstrated via the API

### Requirement: Bruno cloud environment
The Bruno collection SHALL gain a cloud environment carrying the cloud base URL and API key variables, and the collection's requests SHALL send the key header via a variable so the same requests work locally (where no key is enforced) and against the cloud.

#### Scenario: Collection runs against the cloud
- **GIVEN** the cloud environment file is filled in with a deployed URL and key
- **WHEN** the collection runs with the cloud environment selected
- **THEN** health, save, and get requests succeed against the deployed API

#### Scenario: Local environment keeps working
- **WHEN** the collection runs with the local environment against compose
- **THEN** requests behave as before this change
