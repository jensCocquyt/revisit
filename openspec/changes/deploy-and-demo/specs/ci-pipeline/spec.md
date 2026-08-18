# ci-pipeline Delta

## MODIFIED Requirements

### Requirement: Manual Bedrock eval workflow
A separate GitHub Actions workflow SHALL run the evaluation against Bedrock on `workflow_dispatch`, on a weekly schedule, and on pushes to `main` that touch eval-relevant paths — never as a required status check. Scheduled and push-triggered runs SHALL read the model id from a repository variable and use a default region; manual dispatch inputs SHALL still override both. It SHALL authenticate via GitHub OIDC by assuming an AWS IAM role scoped to `bedrock:InvokeModel`, with the role ARN read from a repository variable; long-lived AWS keys SHALL NOT be stored in the repository. The workflow SHALL fail fast with a clear message when the role variable is unset, and on success SHALL publish the full five-measure report as both a job summary and an uploaded artifact. The AWS-side OIDC provider and role creation SHALL be documented as a manual prerequisite.

#### Scenario: Dispatch runs the Bedrock eval and publishes the report
- **GIVEN** the OIDC prerequisite is set up and the role variable is configured
- **WHEN** the workflow is dispatched manually
- **THEN** it assumes the role via OIDC, runs the eval with `ENRICHER=bedrock`, and publishes the full report as a job summary and artifact

#### Scenario: Scheduled run needs no inputs
- **GIVEN** the role and model-id repository variables are configured
- **WHEN** the weekly schedule fires or a push to `main` touches an eval-relevant path
- **THEN** the eval runs with the variable-provided model id and default region and publishes its report

#### Scenario: Missing role variable fails fast
- **GIVEN** the role ARN repository variable is unset
- **WHEN** the workflow is triggered by any of its triggers
- **THEN** it fails immediately with a message explaining the missing prerequisite and pointing at the setup documentation

#### Scenario: Decoupled from the merge gate
- **WHEN** the Bedrock eval workflow fails or is never run
- **THEN** pull requests are unaffected and the merge-gating CI workflow's behavior is unchanged

## ADDED Requirements

### Requirement: Offline Terraform checks in the merge gate
The merge-gating CI workflow SHALL check Terraform formatting and validity (`terraform fmt -check` and `terraform validate` without backend initialization) as an offline job. The merge gate SHALL remain credential-free: no AWS credentials and no network access to AWS in any merge-gating job.

#### Scenario: Malformed Terraform fails CI
- **WHEN** a commit contains unformatted or invalid Terraform
- **THEN** the CI workflow fails and names the offending check

#### Scenario: Terraform checks need no credentials
- **WHEN** the Terraform check job runs
- **THEN** it completes without AWS credentials and without initializing a state backend
