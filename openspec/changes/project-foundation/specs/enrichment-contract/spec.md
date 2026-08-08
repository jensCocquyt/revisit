## ADDED Requirements

### Requirement: Single versioned contract definition validated at boundaries
The enrichment result contract SHALL be defined once as a versioned JSON Schema. The worker SHALL validate results it produces and the API SHALL validate enrichment results it serves against that same definition. A small set of shared fixtures SHALL serve as examples and test inputs; full cross-language conformance testing is deferred.

#### Scenario: Worker validates at its boundary
- **WHEN** the worker produces an enrichment result
- **THEN** the result is validated against the contract schema before it is persisted

#### Scenario: API validates at its boundary
- **WHEN** the API serves an enrichment result
- **THEN** the result validates against the contract schema

#### Scenario: Shared fixtures back unit tests
- **WHEN** unit tests run in either workspace
- **THEN** validation is exercised using fixtures from the shared contract fixtures directory (valid accepted, invalid rejected)

#### Scenario: Contract is versioned
- **WHEN** an enrichment result is produced
- **THEN** it carries the contract version it conforms to

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
