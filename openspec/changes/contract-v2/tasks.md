# Contract v2 — Tasks

## 1. Contract definitions and fixtures

- [x] 1.1 Rewrite `apps/worker/worker/contract.py` to the v2 shape: `contract_version "v2"`, `summary`, `key_takeaway`, `tags` (1–5, unique, lowercase, 1–50 chars), optional complete `Deadline {date, reason, source: EvidenceItem}`, `evidence`; no union
- [x] 1.2 Rewrite `apps/api/src/contract.ts` to mirror it exactly (strict objects, same limits)
- [x] 1.3 Replace `contracts/enrichment/fixtures/` with v2 fixtures including boundary cases: 5 tags valid / 6 invalid, 50-char tag valid / 51 invalid, uppercase tag invalid, duplicate tags invalid, deadline missing `source` invalid, complete deadline valid, no-deadline valid, unknown field invalid, wrong-type invalid
- [x] 1.4 Both fixture-driven contract suites pass (`pytest tests/test_contract.py`, `npm test -- test/contract.test.ts`)

## 2. Enricher seam and implementations

- [x] 2.1 Add `known_tags: tuple[str, ...] = ()` to `EnrichmentInput`; add tag normalization helper (lowercase, trim, collapse whitespace, dedupe) used by implementations before validation
- [x] 2.2 Rewrite `StubEnricher` for v2: hash over `(content, note, goal, known_tags)`; tags drawn deterministically from `known_tags` when provided, else derived from content; deadline emitted on a hash branch with verbatim `source` slice and hash-derived date (no clock); `prompt_version` `stub-v2`
- [x] 2.3 Rewrite the Bedrock enricher for v2: prompt v3 (closed-world tag preference, defensible-date + verbatim-source-sentence rule, omit-when-in-doubt, truncation notice; vocabulary in system prompt, page text in untrusted block), v2 tool schema with per-field descriptions, normalization before `parse_result`; `prompt_version` `bedrock-v3`
- [x] 2.4 Update enricher/Bedrock unit tests (prompt separation, vocabulary placement, normalization, determinism incl. `known_tags`)

## 3. Pipeline

- [x] 3.1 Extend `resolve_evidence` (or add alongside) to verify `deadline.source`: repair offsets like any evidence item; if unresolvable, drop the whole `deadline` and report it distinctly
- [x] 3.2 In `jobs.py`: read the tag vocabulary (distinct tags from `enrichments.result->'tags'`, frequency-ordered, capped at 100) via autocommit query before enrichment; pass as `known_tags`; log `deadline dropped` events; log derived new-tag count on persistence
- [x] 3.3 Update integration tests: vocabulary flows into enrichment (seed rows, assert stub receives/uses them), cold start, deadline-source drop path, persisted deadline source resolves exactly

## 4. API surface

- [x] 4.1 Update the API's enrichment-result serving path and OpenAPI schema for the v2 shape — audited: the API does not yet serve enrichment results, so only `contract.ts` changes; no route/OpenAPI edits exist to make
- [x] 4.2 Update `bruno/` assertions touching result fields in the same commit; `bruno.test.ts` and API suite pass — no result fields in the collection; suite green unchanged

## 5. Evals

- [x] 5.1 Relabel `apps/worker/evals/fixtures/*.json` to `expected_tags` + `expected_deadline` (date or null); keep multiple deadline and no-deadline cases; adjust snapshots only if a case no longer exercises anything — added `framework-lts-eol` (software-EOL archetype)
- [x] 5.2 Rewrite `worker/evals.py` measures: schema validity + evidence resolution (gated, unchanged semantics), false-deadline rate, deadline recall, date accuracy, tag precision/recall; per-case rows updated
- [x] 5.3 Update `test_evals.py` (determinism, gate semantics, false-deadline counting); run `python -m worker.evals` and `--gate` on the stub

## 6. Verification

- [x] 6.1 Full worker suite (ruff format check, ruff check, pytest with `DATABASE_URL`) and API suite (biome lint, vitest with `DATABASE_URL`) green locally
- [x] 6.2 Stack smoke: `python -m worker.smoke` produces a contract-valid v2 result; `stack-e2e` path unaffected
- [ ] 6.3 After merge: dispatch the Bedrock eval once to set the v2 baseline and record it on the PR
