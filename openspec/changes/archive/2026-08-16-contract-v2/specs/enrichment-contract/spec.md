# enrichment-contract Specification (delta)

## MODIFIED Requirements

### Requirement: Contract expresses the build-spec result shape
The v2 contract SHALL include `contract_version` (`"v2"`), `summary`, `key_takeaway`, `tags`, an optional `deadline`, and `evidence` items with quote and offsets. `tags` SHALL contain 1–5 unique labels, each trimmed, lowercase, and 1–50 characters. `deadline`, when present, SHALL be complete: `date` (ISO date), `reason` (1–500 chars), and `source` — an evidence item quoting the sentence in the page text that asserts the date. The v1 fields `save_intent`, `recommended_action`, `topics`, `suggested_group`, and the revisit variant are removed.

#### Scenario: Deadline is complete or absent
- **WHEN** a result with a `deadline` missing any of `date`, `reason`, or `source` is validated
- **THEN** validation rejects it

#### Scenario: Absent deadline is a valid outcome
- **WHEN** a result with no `deadline` field is validated
- **THEN** validation accepts it

#### Scenario: Tag constraints are enforced
- **WHEN** a result with six tags, an uppercase tag, or a 51-character tag is validated
- **THEN** validation rejects it

### Requirement: Deterministic enrichment stub
The worker SHALL provide a stub implementation of the AI interface that produces schema-valid v2 results deterministically from its input — content, note, goal, and the provided tag vocabulary — without any network access, and SHALL use it as the default enricher. When a vocabulary is provided, the stub's tags SHALL be drawn from it deterministically.

#### Scenario: Stub output is contract-valid
- **WHEN** the stub enriches any input content
- **THEN** the result validates against the v2 contract schema

#### Scenario: Stub is deterministic
- **WHEN** the stub enriches the same content, context, and vocabulary twice
- **THEN** both results are identical

#### Scenario: Stub is the default
- **WHEN** the worker starts with no enricher explicitly configured
- **THEN** the stub enricher is selected and no external model credentials are required

### Requirement: Shared fixtures are the conformance contract
A shared fixture directory SHALL hold valid and invalid example results, named so the expected outcome is derivable from the filename. Both languages' test suites SHALL run every fixture and assert the expected outcome, and fixtures SHALL cover each constraint whose divergence between the two definitions would change observable behavior — tag count and length boundaries, casing, deadline completeness, evidence edge cases, unknown fields, and wrong-type values. All v1 fixtures are replaced by v2 fixtures.

#### Scenario: Fixture accepted or rejected identically in both languages
- **WHEN** any shared fixture is validated by both the Zod and the pydantic definition
- **THEN** both produce the outcome the fixture's name declares

#### Scenario: Divergence between definitions fails tests
- **WHEN** one language's definition is changed so a fixture's outcome differs from its declared expectation
- **THEN** that language's unit test suite fails

### Requirement: Bedrock prompt carries decision criteria and field guidance
The Bedrock enricher's model request SHALL instruct the model on v2 semantics in the system prompt: prefer tags from the provided vocabulary and invent a new tag only when nothing fits, named consistently with the existing ones; assert a `deadline` only when the page ties its value to a concrete, defensible date, with `source` quoting the asserting sentence verbatim, and omit the deadline when in doubt; and note that the page text may be truncated mid-sentence. The tool schema SHALL carry a `description` for each of `summary`, `key_takeaway`, `tags`, `deadline`, and `evidence` stating the field's purpose and limits. The tag vocabulary is trusted user data and SHALL appear in the system prompt's instruction section, never inside the delimited untrusted page content. This guidance SHALL NOT change what the contract accepts.

#### Scenario: System prompt contains tag and deadline discipline
- **WHEN** the Bedrock enricher builds its model request
- **THEN** the system prompt states the closed-world tag preference, the defensible-date rule with verbatim source sentence, omission as the default when no date is defensible, and the truncation notice

#### Scenario: Vocabulary stays out of the untrusted block
- **GIVEN** a tag vocabulary and extracted page text
- **WHEN** the Bedrock enricher builds its model request
- **THEN** the vocabulary appears in the system prompt and the page text only in the delimited untrusted-content section

#### Scenario: Prompt generation is identifiable as bedrock-v3
- **WHEN** the Bedrock enricher produces an outcome under the v2 prompt
- **THEN** the enricher's `prompt_version` is `bedrock-v3`

## ADDED Requirements

### Requirement: Enricher input carries the tag vocabulary
`EnrichmentInput` SHALL carry the library's existing tag vocabulary (`known_tags`, possibly empty) alongside content, note, and goal. Enricher implementations SHALL normalize model-produced tags (lowercase, trim, collapse whitespace, dedupe) before strict contract validation. Whether an assigned tag is new SHALL be determined by code comparing against the provided vocabulary, never self-reported by the model.

#### Scenario: Empty vocabulary is valid input
- **WHEN** an enricher runs with an empty `known_tags`
- **THEN** enrichment succeeds and tags are derived from the content alone

#### Scenario: Tags are normalized before validation
- **GIVEN** a model response containing the tags "Angular " and "angular"
- **WHEN** the enricher normalizes and validates the result
- **THEN** the result contains the single tag "angular"
