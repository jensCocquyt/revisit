# Proposal: enricher-prompt-v2

## Why

The Bedrock enricher's prompt explains the contract's *rules* (revisit invariant, untrusted content, verbatim evidence) but barely explains its *fields*: `summary`, `key_takeaway`, `topics`, and `suggested_group` get no guidance at all, the `action` vs `read_soon` boundary is undefined, and none of the contract's length limits are stated. The model can only discover a limit (e.g. the 500-char quote cap) by failing strict validation, which burns a retry attempt. Better field guidance and contrastive decision criteria should improve output quality and reduce `invalid_model_output` retries at negligible token cost.

## What Changes

- `SYSTEM_PROMPT` in `worker/enrichers/bedrock.py` gains contrastive decision criteria for the `save_intent` and `recommended_action` enums (what distinguishes `action` from `read_soon`, when `revisit` is and is not justified, `none` framed as the common correct answer via a decision rule rather than a plea).
- `SYSTEM_PROMPT` states that the page content may be truncated mid-sentence and must not be read as the article's conclusion.
- `_tool_schema()` post-processing adds per-field `description` entries (purpose, shape, and length targets for `summary`, `key_takeaway`, `topics`, `suggested_group`, `evidence`), keeping field guidance in the tool schema where it belongs and the system prompt lean.
- `PROMPT_VERSION` bumps to `bedrock-v2`, creating a new enrichment generation under the existing `(link_id, content_hash, prompt_version)` idempotency key — v1 and v2 rows coexist for before/after comparison.

Explicitly out of scope: no contract shape changes, no fixture changes, no API or Bruno changes, no few-shot examples, no change to `MAX_CONTENT_CHARS`, no changes to the stub enricher or to job processing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `enrichment-contract`: the Bedrock enricher's model request SHALL carry decision criteria for the contract enums and per-field guidance (including length limits) in the tool schema, and SHALL flag possible content truncation; prompt version becomes `bedrock-v2`.

## Impact

- Code: `apps/worker/worker/enrichers/bedrock.py` only (`SYSTEM_PROMPT`, `_tool_schema()`, `PROMPT_VERSION`).
- Tests: existing Bedrock enricher tests updated where they assert on prompt/schema content or `bedrock-v1`; no new test infrastructure.
- Data: new enrichments persist with `prompt_version = "bedrock-v2"`; existing rows untouched.
- No new dependencies, no infrastructure changes.
