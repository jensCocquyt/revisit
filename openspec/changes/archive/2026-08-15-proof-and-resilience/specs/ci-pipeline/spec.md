# ci-pipeline Specification (delta)

## ADDED Requirements

### Requirement: CI runs the stub eval offline and gates on provable measures
The merge-gating CI workflow SHALL run the evaluation command with the stub enricher and gate on schema validity and evidence resolution rate being 100%. Accuracy measures SHALL be reported but never gate. The merge-gating workflow SHALL remain fully offline and credential-free: no live network fetches, no AWS credentials, eval inputs are committed snapshots.

#### Scenario: Eval gate passes on a healthy stub
- **WHEN** CI runs on a commit where the stub produces contract-valid results with fully resolvable evidence for every eval case
- **THEN** the eval step passes

#### Scenario: Eval gate fails on a provable regression
- **WHEN** a commit makes the stub emit contract-invalid output or unresolvable evidence for any eval case
- **THEN** the eval step fails the CI run and the report names the failing measure

#### Scenario: Merge gate needs no credentials
- **WHEN** the CI workflow runs
- **THEN** it completes without AWS credentials and without fetching any live web page

### Requirement: Manual Bedrock eval workflow
A separate GitHub Actions workflow SHALL run the evaluation against Bedrock on `workflow_dispatch` only — no schedule, and never a required status check. It SHALL authenticate via GitHub OIDC by assuming an AWS IAM role scoped to `bedrock:InvokeModel`, with the role ARN read from a repository variable; long-lived AWS keys SHALL NOT be stored in the repository. The workflow SHALL fail fast with a clear message when the role variable is unset, and on success SHALL publish the full five-measure report as both a job summary and an uploaded artifact. The AWS-side OIDC provider and role creation SHALL be documented as a manual prerequisite.

#### Scenario: Dispatch runs the Bedrock eval and publishes the report
- **GIVEN** the OIDC prerequisite is set up and the role variable is configured
- **WHEN** the workflow is dispatched manually
- **THEN** it assumes the role via OIDC, runs the eval with `ENRICHER=bedrock`, and publishes the full report as a job summary and artifact

#### Scenario: Missing role variable fails fast
- **GIVEN** the role ARN repository variable is unset
- **WHEN** the workflow is dispatched
- **THEN** it fails immediately with a message explaining the missing prerequisite and pointing at the setup documentation

#### Scenario: Decoupled from the merge gate
- **WHEN** the Bedrock eval workflow fails or is never run
- **THEN** pull requests are unaffected and the merge-gating CI workflow's behavior is unchanged
