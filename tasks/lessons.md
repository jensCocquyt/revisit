# Lessons

Corrections from review, recorded so they are not repeated.

- **Prefer ABC over `typing.Protocol` for seams** (PR #1 review). The owner finds explicit inheritance clearer than structural typing. New interfaces: `abc.ABC` + `@abstractmethod`; implementations subclass explicitly.
- **One class per module for implementations.** Seam/interface modules hold the interface, data carriers, and factory; each implementation (e.g. `StubEnricher`) lives in its own file.
- **No inline scripts in CI.** Multi-line heredoc scripts in workflow YAML are hard to read and review; ship them as real modules (e.g. `worker/smoke.py`) and invoke with one line.
- **Keep cross-language names in sync.** Contract types must carry the same names in TS and Python (`EvidenceItem`, `RevisitSuggestion`, `NonRevisitResult`, `RevisitResult`, `EnrichmentResult`).
- **Docs are part of the change.** README sections describing replaced designs must be updated in the same commit that replaces them (stale contract section slipped through in the schema→native-types rework).
- **Comments: concise, clean, human.** State only what the code can't show, in one short sentence; no narration, no design-history asides.
- **Public API first, private helpers at the bottom — in Python too.** The PR #5 rule (exported entry function opens the file, schemas/consts/privates below) applies to worker modules, not just the API. Python evaluates signature annotations eagerly, so entry-first ordering needs `from __future__ import annotations`; defaults referencing later names use a `None` fallback. Prefer descriptive module names over grabby verbs (`safe_fetch.py`, not `fetch.py`).
