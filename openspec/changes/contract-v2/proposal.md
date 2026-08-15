# Contract v2 — tags and deadline replace the intent/action taxonomy

## Why

The v1 taxonomy (`save_intent` × `recommended_action`, 12 combinations) answers a question the product doesn't ask. The owner's actual needs are two: **find saved things again** (topical grouping) and **don't miss time-bound things** (a defensible date with a reason, feeding future notifications). The first Bedrock eval made the mismatch measurable — ~54% accuracy on enum boundaries that are fuzzy even to the label author — and exploration (2026-08-15) concluded the taxonomy is a lossy projection of two simpler primitives: an optional **deadline** attribute and a **tag** set. Changing the contract now is the cheapest it will ever be: no real user data exists yet.

## What Changes

- **BREAKING** — Contract v2 replaces the v1 result shape. `save_intent`, `recommended_action`, `suggested_group`, and the revisit discriminated union are removed. The v2 result is flat:
  - `contract_version: "v2"`
  - `summary`, `key_takeaway`, `evidence` — unchanged semantics and limits
  - `tags`: 1–5 labels, normalized (lowercase, trimmed), replacing both `topics` and `suggested_group`
  - `deadline` (optional): `{date, reason}` — present only when the page's value is tied to a concrete, defensible date (EOL, sale window, event). Replaces the `revisit` variant. Absence means "reference material, nothing to do".
- **Closed-world tag assignment**: the `Enricher` seam input gains `known_tags` — the library's existing tag vocabulary. The prompt instructs: strongly prefer existing tags; invent a new tag only when nothing fits, named consistently with the existing ones. Whether an assigned tag is new is **derived in code** (set comparison at persistence time), never self-reported by the model.
- **Evidence-grounded deadlines**: when `deadline` is present, its date must be supported by page text — at least one evidence item must contain the date (or the phrase stating it), and that item must resolve against the stored extracted text under the existing evidence rules. An unsupported date is treated like unresolvable evidence: the deadline is dropped, not guessed. A hallucinated summary wastes a read; a hallucinated date fires a future notification about nothing.
- **Both contract definitions and all shared fixtures rewritten together** (Zod + pydantic + `contracts/enrichment/fixtures/`), per the contract-change rule. Boundary fixtures for the new constraints (tag count/length limits, deadline with/without evidence backing) in the same commit.
- **Bedrock prompt v3** and stub updated to produce v2 results; `prompt_version` bumps.
- **Eval set relabelled and measures redefined**: labels become `expected_tags` and `expected_deadline` (date or null). Measures: schema validity and evidence resolution (gated, unchanged); **false-deadline rate** (deadline asserted where none is defensible — successor of false-revisit rate, now the headline quality measure); deadline recall (real dates found) and date accuracy; tag quality (set overlap against expected tags, reported only).
- **No stored-data migration**: pre-launch, existing v1 enrichment rows are not migrated; re-enrichment produces v2 rows. The API serves whatever contract version a stored result carries or is simply reset locally.

New infrastructure: none. This is a reshaping of existing seams.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `enrichment-contract`: the result shape itself — v2 fields, tag constraints, the deadline object and its evidence-grounding invariant, removal of the v1 enums and structural revisit invariant.
- `job-processing`: the pipeline passes `known_tags` into enrichment (vocabulary read in a short transaction, like all DB work) and enforces deadline evidence-grounding before persistence, alongside existing evidence resolution.
- `enrichment-evals`: relabelled fixtures and the redefined measure set (false-deadline rate, deadline recall/accuracy, tag overlap; gates unchanged).

## Impact

- `apps/api/src/contract.ts`, `apps/worker/worker/contract.py`, `contracts/enrichment/fixtures/` — rewritten together.
- `apps/worker/worker/enrichers/` — seam input (`known_tags`), stub derivation, Bedrock prompt v3.
- `apps/worker/worker/jobs.py` / `evidence.py` — vocabulary lookup, deadline grounding check.
- `apps/worker/evals/fixtures/` + `worker/evals.py` — relabelling and new measures.
- API response schema (OpenAPI) changes shape where enrichment results are returned; `bruno/` assertions updated in the same commit per the collection-sync rule.
- Eval baseline resets — v1 and v2 reports are not comparable; the first v2 Bedrock run establishes the new baseline.

## Out of Scope

- Notifications (delivery, scheduling, lead time) — `deadline` is deliberately notification-ready data, nothing more.
- Tag curation surface (merge/rename, new-tag review/accept flow) — new-tag detection is derived and can be logged, but no API or UI for acting on it.
- "Groups" as a first-class concept — a group is a saved tag filter; any such view layer is future UX.
- Derived time views (`upcoming`, `expired`) as API endpoints — nothing mutates when a date passes; views are read-time queries for a later change.
- Embeddings/similarity for tag convergence; multi-user vocabularies; migrating stored v1 rows.
