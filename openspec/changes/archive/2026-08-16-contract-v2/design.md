# Contract v2 — Design

## Context

v1's result shape carries two enums (`save_intent`, `recommended_action`) whose discriminated union gates the `revisit` object. Exploration (2026-08-15) reduced the product's real needs to two primitives: an optional, evidence-grounded **deadline** and a **closed-world tag set**. The pipeline around the contract (fetch, extract, evidence resolution, idempotent persistence, evals) is taxonomy-agnostic and carries over. No production data exists; no migration burden.

## Goals / Non-Goals

**Goals:**

- Flat v2 result: `summary`, `key_takeaway`, `tags`, optional `deadline {date, reason, source}`, `evidence`.
- Deadline dates grounded in page text via the existing verbatim-resolution rule.
- Tag convergence via closed-world assignment (`known_tags` seam input) plus mechanical normalization.
- Eval measures that put fabricated time-pressure (false-deadline rate) at the center.

**Non-Goals:**

- Notifications, time views, tag curation APIs/UX, groups, embeddings, v1 row migration (all listed in the proposal).
- No new tables or services; vocabulary is derived from existing data.

## Decisions

### 1. `deadline` carries its own source quote — no index coupling to `evidence[]`

`deadline: {date, reason, source}` where `source` is a standard evidence item (quote + offsets) whose quote is **the sentence asserting the date** — not necessarily the literal date string, since pages write dates in arbitrary formats ("end of May next year"). Owner decision 2026-08-15: sentence-level backing is sufficient.

- *Why inline, not an index into `evidence[]`*: evidence resolution repairs and drops items, shifting indices; an index would dangle. A self-contained `source` is verified by the same `resolve_evidence` logic: offsets repaired to the first verbatim occurrence; if the quote is absent from the stored text, the **whole `deadline` is dropped, not guessed** — extending the v1 evidence invariant to the field that will eventually drive notifications. A dropped deadline emits a `deadline dropped` log event (countable, like `evidence dropped`).
- *What is and isn't guaranteed*: structurally, the quote resolves verbatim in stored text (machine-checked). That the sentence actually asserts the date is semantic and is guarded by the eval (false-deadline rate, date accuracy), not by code. Stated plainly so nobody mistakes the check for more than it is.

### 2. Tags: 1–5, normalized, closed-world preferred

- Contract constraints (both definitions): 1–5 items, each 1–50 chars, trimmed, lowercase (no uppercase permitted), unique within the list.
- Normalization (lowercase, trim, collapse internal whitespace, dedupe) happens **in the enricher implementations before the result is parsed** — model output is cleaned, then validated strictly. The stub emits conforming tags directly.
- `EnrichmentInput` gains `known_tags: tuple[str, ...]` (empty allowed — cold start). Prompt rule: prefer existing tags; invent only when nothing fits, naming consistently. New-tag detection is a set comparison in the worker at persistence time, logged, not model-reported.

### 3. `known_tags` is derived from stored enrichments — no vocabulary table

Read in a short autocommit query before enrichment (never inside a transaction, per the slow-work invariant): distinct tags from `enrichments.result->'tags'`, ordered by frequency, capped at 100. A dedicated tags table is speculative infrastructure at this scale; revisit only if the query measurably hurts.

Consequence for idempotency, documented rather than solved: enrichment output is no longer a pure function of `(content, note, goal)` — it also depends on vocabulary state at processing time. The persistence key `(link_id, content_hash, prompt_version)` and its conflict-is-success semantics are unchanged; at-least-once retries may see a different vocabulary, and the first persisted result wins. Acceptable: tags are suggestions over the same content, not facts.

### 4. Flat union-free contract; `v2` only

`contract_version: Literal["v2"]`; one model (pydantic) / one object schema (Zod), `deadline` optional, strict/`extra="forbid"` everywhere. The v1 structural invariant (revisit only on the revisit variant) is replaced by a simpler one: `deadline` is either absent or complete (`date`, `reason`, `source` all required within it). `parse_result` accepts v2 only; all v1 fixtures are replaced by v2 fixtures, including boundary cases: 5 tags (valid) / 6 (invalid), 50-char tag (valid) / 51 (invalid), uppercase tag (invalid), deadline missing `source` (invalid), deadline whose source quote resolves (valid).

### 5. Stub stays a deterministic function of its (expanded) input

The stub derives from a SHA-256 of `(content, note, goal, known_tags)`: tags are picked deterministically from `known_tags` when provided (hash-indexed) and synthesized from content tokens otherwise; on a hash branch it emits a `deadline` whose `source` quote is a verbatim slice of the content (like stub evidence today) and whose date is hash-derived (fixed future range, no clock access). Same input → identical output, still no network; the eval determinism test carries over.

### 6. Bedrock prompt v3

System prompt drops the taxonomy rules and gains: tag assignment (closed-world preference, naming consistency, 1–5), deadline discipline (only with a concrete defensible date; `source` must quote the asserting sentence verbatim; when in doubt, omit — successor of the "none is the most common correct answer" rule, now aimed at the right target). `prompt_version` → `bedrock-v3`. Page content remains delimited untrusted data; `known_tags` are trusted user data and live in the system prompt's rules section, not the untrusted block.

### 7. Evals: relabel, refocus measures, keep the gates

Labels per case: `expected_tags` (list), `expected_deadline` (ISO date or null). Measures:

| Measure | Gated | Definition |
| --- | --- | --- |
| Schema validity | yes | unchanged |
| Evidence resolution rate | yes | unchanged, now includes `deadline.source` items |
| False-deadline rate | no (headline) | cases with `expected_deadline: null` where a deadline was asserted |
| Deadline recall | no | cases with an expected date where *a* deadline was produced |
| Date accuracy | no | exact date match among produced deadlines with an expected date |
| Tag precision/recall | no | set overlap of produced vs expected tags (reported as two numbers; no F1 ceremony) |

Stub run remains byte-deterministic; CI gate (`--gate`) semantics unchanged. The v1 accuracy measures disappear; the first v2 Bedrock dispatch sets the new baseline.

### 8. API and collection

`contract.ts` mirrors v2 (parity rules unchanged: strict objects, identical limits, JSON-mode semantics). The OpenAPI response schema for enrichment results changes shape; `bruno/` assertions update in the same commit (collection-sync rule). No endpoint added or removed.

## Risks / Trade-offs

- [Tag sprawl despite closed world] → cap at 5 per link, normalization, frequency-ordered vocabulary in the prompt; curation UX deferred deliberately.
- [Vocabulary query on jsonb grows slow] → capped at 100, personal-scale data; promote to a table only on measured pain.
- ["Sentence asserts the date" is semantically unverifiable in code] → structural check (verbatim resolution) + eval pressure (false-deadline, date accuracy); accepted explicitly.
- [Breaking rewrite touches every contract surface at once] → pre-launch, no stored data that matters; the fixture suite keeps both languages honest through the rewrite; task ordering keeps increments testable.
- [Vocabulary-dependent output vs idempotency intuitions] → documented in Decision 3; persistence semantics unchanged.

## Open Questions

None — sentence-level deadline backing (owner, 2026-08-15), key_takeaway retained, derived new-tag detection, and no-migration are all settled in the proposal.
