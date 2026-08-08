# enrichment-contract Specification

## Purpose
TBD - created by archiving change project-foundation. Update Purpose after archive.
## Requirements
### Requirement: Contract expresses the build-spec result shape
The contract SHALL include summary, key takeaway, topics, suggested group, save intent (`reference`, `read_later`, `time_sensitive`), recommended action (`none`, `read_soon`, `action`, `revisit`), optional revisit suggestion, and evidence items with quote and offsets.

#### Scenario: Revisit action requires reason and timing
- **WHEN** a result with recommended action `revisit` but no revisit reason or suggested date is validated
- **THEN** validation rejects it

#### Scenario: None is a valid outcome
- **WHEN** a result with recommended action `none` and no revisit suggestion is validated
- **THEN** validation accepts it

### Requirement: Deterministic enrichment stub
The worker SHALL provide a stub implementation of the AI interface that produces schema-valid results deterministically from its input, without any network access, and SHALL use it as the default enricher.

#### Scenario: Stub output is contract-valid
- **WHEN** the stub enriches any input content
- **THEN** the result validates against the contract schema

#### Scenario: Stub is deterministic
- **WHEN** the stub enriches the same content and context twice
- **THEN** both results are identical

#### Scenario: Stub is the default
- **WHEN** the worker starts with no enricher explicitly configured
- **THEN** the stub enricher is selected and no external model credentials are required

### Requirement: Native contract definitions validated at boundaries
The enrichment result contract SHALL be defined natively in each language — a Zod definition in the API and a pydantic definition in the worker — both carrying the contract version and yielding static types. The worker SHALL validate results it produces before persisting them and the API SHALL validate enrichment results it serves.

#### Scenario: Worker validates at its boundary
- **WHEN** the worker produces an enrichment result
- **THEN** the result is validated by constructing the pydantic contract model before it is persisted

#### Scenario: API validates at its boundary
- **WHEN** the API serves an enrichment result
- **THEN** the result is parsed with the Zod contract definition and rejected if invalid

#### Scenario: Unknown fields are rejected in both languages
- **WHEN** a result containing a field outside the contract is validated in either language
- **THEN** validation rejects it

#### Scenario: Contract is versioned
- **WHEN** an enrichment result is produced
- **THEN** it carries the contract version it conforms to

### Requirement: Shared fixtures are the conformance contract
A shared fixture directory SHALL hold valid and invalid example results, named so the expected outcome is derivable from the filename. Both languages' test suites SHALL run every fixture and assert the expected outcome, and fixtures SHALL cover each constraint whose divergence between the two definitions would change observable behavior — enum values, length boundaries, revisit presence per recommended action, evidence edge cases, unknown fields, and wrong-type values.

#### Scenario: Fixture accepted or rejected identically in both languages
- **WHEN** any shared fixture is validated by both the Zod and the pydantic definition
- **THEN** both produce the outcome the fixture's name declares

#### Scenario: Divergence between definitions fails tests
- **WHEN** one language's definition is changed so a fixture's outcome differs from its declared expectation
- **THEN** that language's unit test suite fails

