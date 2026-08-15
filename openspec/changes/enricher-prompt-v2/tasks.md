# Tasks: enricher-prompt-v2

## 1. Prompt and schema updates

- [x] 1.1 Rewrite `SYSTEM_PROMPT` in `apps/worker/worker/enrichers/bedrock.py`: keep the existing rules (contract_version, verbatim evidence with offsets, untrusted page content, note/goal weighting) and add contrastive decision criteria for `save_intent` (reference / read_later / time_sensitive) and `recommended_action` (action vs read_soon boundary, revisit requires a specific defensible date, none as the common correct answer via a decision rule), plus the one-line truncation notice
- [x] 1.2 Extend `_tool_schema()` to set `description` on `summary`, `key_takeaway`, `topics`, `suggested_group`, and `evidence` (purpose, shape target, and length limits — including the 500-char quote cap and the verbatim rule on evidence)
- [x] 1.3 Bump `PROMPT_VERSION` to `"bedrock-v2"`

## 2. Tests

- [x] 2.1 Update existing Bedrock enricher tests that reference `bedrock-v1` or assert on prompt/schema content; assert on stable markers (criteria keywords present in the system prompt, non-empty descriptions on the five fields, truncation notice present, `prompt_version == "bedrock-v2"`), not full-text equality
- [x] 2.2 Run focused tests (`uv run pytest tests/test_bedrock_enricher.py` or equivalent), then the full worker suite (`uv run pytest`) and lint (`uv run ruff format --check . && uv run ruff check .`)

## 3. Manual verification

- [x] 3.1 Run the stack with `ENRICHER=bedrock` and AWS credentials; save 3–5 real links spanning the action spectrum (plain article, page with a deadline, evergreen reference); confirm each enrichment is contract-valid, persisted with `prompt_version = "bedrock-v2"`, and carries a sensible `recommended_action`; compare against `bedrock-v1` rows where the same link was previously enriched
