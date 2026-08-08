## REMOVED Requirements

### Requirement: Single versioned contract definition validated at boundaries
**Reason**: Replaced by native per-language contract definitions with static types; the single JSON Schema artifact gave runtime validation but no typing and required fragile runtime path coupling.
**Migration**: The contract shape is unchanged. TypeScript call sites use the Zod-backed `validateEnrichmentResult`; Python call sites use the pydantic-backed validation entry point. The schema file is deleted; shared fixtures remain the cross-language conformance suite.

## ADDED Requirements

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
