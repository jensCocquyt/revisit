# Delta: enrichment-contract (enricher-prompt-v2)

## ADDED Requirements

### Requirement: Bedrock prompt carries decision criteria and field guidance
The Bedrock enricher's model request SHALL give the model contrastive decision criteria for the `save_intent` and `recommended_action` enums in the system prompt — including the boundary between `action` and `read_soon`, the rule that `revisit` requires a specific defensible date, and `none` framed as a normal, common outcome — and SHALL state that the page text may be truncated mid-sentence. The `record_enrichment` tool schema SHALL carry a `description` for each of `summary`, `key_takeaway`, `topics`, `suggested_group`, and `evidence` stating the field's purpose and shape, including the contract's length limits where the model is likely to exceed them. This guidance SHALL NOT change what the contract accepts: validation remains the strict native contract, unchanged.

#### Scenario: System prompt contains enum criteria and truncation notice
- **WHEN** the Bedrock enricher builds its model request
- **THEN** the system prompt distinguishes each `recommended_action` value from its neighbors, requires a concrete date for `revisit`, presents `none` as an expected outcome, and notes that the page text may be truncated

#### Scenario: Tool schema fields carry descriptions
- **WHEN** the Bedrock enricher builds its tool schema
- **THEN** `summary`, `key_takeaway`, `topics`, `suggested_group`, and `evidence` each have a non-empty `description`, and the evidence description states the verbatim-quote rule and the 500-character quote limit

#### Scenario: Prompt generation is identifiable as bedrock-v2
- **WHEN** the Bedrock enricher produces an outcome under the updated prompt
- **THEN** the enricher's `prompt_version` is `bedrock-v2`, so persisted enrichments are distinguishable from `bedrock-v1` rows and both generations can coexist under the `(link_id, content_hash, prompt_version)` key
