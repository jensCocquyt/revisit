# Design: enricher-prompt-v2

## Context

`BedrockEnricher` makes one Converse call with a forced `record_enrichment` tool. The system prompt covers the contract rules (revisit invariant, untrusted page content, verbatim evidence with offsets) but gives the model no guidance on field shape or length, and only one-line definitions of the enums. The tool schema — built in `_tool_schema()` from the pydantic `RevisitResult` model — carries no field descriptions except the one added for `revisit`. Strict JSON-mode validation (`parse_result`) is the correctness gate; a response that violates a length limit or picks a wrong enum shape becomes a transient `invalid_model_output` retry. The prompt is therefore purely a quality/efficiency lever: better guidance means fewer wasted attempts and better-calibrated fields, with no change to what the system accepts.

## Goals / Non-Goals

**Goals:**
- Give the model contrastive decision criteria for `save_intent` and `recommended_action`.
- State per-field purpose, shape, and length limits so the model self-polices instead of discovering limits through validation failure.
- Tell the model the content may be truncated.
- Make the new generation identifiable and comparable via `prompt_version = "bedrock-v2"`.

**Non-Goals:**
- No contract, fixture, API, or Bruno changes.
- No few-shot examples (they anchor tone/length, cost tokens per call, and current models follow criteria well without them; revisit only if a concrete failure mode appears that criteria cannot fix).
- No change to `MAX_CONTENT_CHARS`, the failure taxonomy, retry behavior, or the stub.
- No prompt-quality eval harness (deferred with the PR-4 eval set).

## Decisions

### 1. Enum decision criteria live in `SYSTEM_PROMPT`; field guidance lives in `_tool_schema()` descriptions

Rationale: decision criteria are behavioral instructions — the system prompt is their natural home. Field-shape guidance (purpose, length target) is contract-adjacent documentation — JSON Schema `description` fields are the idiomatic carrier, models attend to them well, and putting them in `_tool_schema()` post-processing keeps the shared pydantic contract untouched (no Zod parity work, no fixtures). `_tool_schema()` already mutates the generated schema (widened `recommended_action`, optional `revisit`), so this extends an existing pattern rather than adding a new one.

Alternative considered: `Field(description=...)` on the pydantic models — rejected because the contract is the cross-language seam; decorating it with Bedrock-prompt concerns couples the seam to one enricher and forces mirrored edits in the Zod definition to keep the definitions honest.

### 2. Criteria are contrastive, calm, and rule-shaped

Each enum value gets a one-line definition plus its boundary against the neighbors it is most confused with (`action` = the page implies a concrete task; `read_soon` = reading soon is the point and value decays; `revisit` = value peaks at a specific defensible date, otherwise forbidden; `none` = summary captures it — framed as the most common correct answer). The existing "do not manufacture follow-up" guardrail is kept but attached to the decision rule. No caps-lock emphasis: current models follow calm instructions closely, and inflated emphasis causes overtriggering.

### 3. Length limits stated as targets, not just caps

Descriptions give a working target below the contract cap (e.g. summary "2–4 sentences", topics "3–6 short lowercase noun phrases") plus the hard limit where failure is likely (500-char quotes). Targets shape typical output; caps prevent validation retries. The contract's wider ranges (up to 10 topics, 2000-char summary) remain valid — validation is unchanged.

### 4. Truncation notice is one sentence

"The page text may be truncated mid-sentence; do not treat the cutoff as the article's conclusion." Prefix truncation semantics (offsets valid against stored text) are unaffected.

### 5. `PROMPT_VERSION = "bedrock-v2"`

Required by the existing spec (prompt version changes whenever the template changes) and by the idempotency model: the unique key `(link_id, content_hash, prompt_version)` makes v2 a new generation, so re-enriching a link already processed under v1 produces a second row instead of being deduped away. This is also the comparison mechanism — same link, both generations, side by side in SQL.

## Risks / Trade-offs

- [Longer prompt raises per-call input tokens] → ~400–600 extra tokens ≈ well under a tenth of a cent per call at current model prices; accepted.
- [New guidance could shift output distribution in unwanted ways (e.g. fewer `revisit` results than desired)] → v1 rows remain in the DB for comparison; manual before/after check on real links is part of the tasks; a prompt-only revert is a one-line `PROMPT_VERSION` change back plus template restore.
- [Tests asserting exact prompt text become brittle] → assert on stable markers (presence of criteria keywords, schema descriptions, version string), not full-text equality.

## Migration Plan

Deploy worker; no schema or config changes. New jobs enrich under `bedrock-v2`. Rollback = redeploy previous worker image; v2 rows are inert historical data. Manual verification: run the stack with `ENRICHER=bedrock`, save 3–5 real links spanning the action spectrum (a plain article, a page with a deadline, an evergreen reference), confirm contract-valid results and sensible `recommended_action` choices, and compare against v1 rows where they exist.

## Open Questions

None — the topics target (3–6) is a prompt-level suggestion the contract does not enforce, so it can be tuned later without another spec change.
