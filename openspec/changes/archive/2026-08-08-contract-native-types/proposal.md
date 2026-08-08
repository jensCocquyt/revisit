## Why

The shared JSON Schema gives correct runtime validation but poor developer experience: no static types in either language, Ajv/CJS interop warts in the API, dict-building in the worker, and a load-bearing runtime path coupling (`../../../contracts/...`) baked into both apps and both Dockerfiles. PR 2 builds link submission and worker persistence directly on this seam — reworking it after that code exists is the expensive version, so the switch happens now.

## What Changes

- **BREAKING (internal seam):** `contracts/enrichment/v1.schema.json` is deleted. The contract is defined natively twice: a Zod discriminated union in the API, a pydantic discriminated union in the worker.
- The shared fixture directory (`contracts/enrichment/fixtures/`) is promoted to being the cross-language conformance contract: both test suites glob the same files with the same accept/reject convention, and coverage expands from 6 fixtures to every constraint boundary (enum values, length limits, `revisit` presence per action, empty evidence, offset edges).
- API: Ajv and ajv-formats are removed; contract validation becomes Zod parsing with inferred static types.
- Worker: `jsonschema` is removed; validation becomes pydantic model construction; the stub returns model instances instead of hand-built dicts.
- Runtime images no longer need the contracts directory: validation lives in code; fixtures are test-time only. The `COPY contracts` Dockerfile steps and the fragile path depth requirement disappear.
- The CI stack job keeps exercising the stub in-container; it now validates via pydantic instead of the schema file.

Out of scope: any change to the contract's *shape* (fields, enums, semantics stay exactly as specced), product endpoints, job processing, OpenAPI generation (PR 5 adopts `@hono/zod-openapi` on top of the Zod definition introduced here).

No new infrastructure.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `enrichment-contract`: the "single schema definition validated in both languages" requirement is replaced by "native definition per language + shared fixtures as the conformance suite". Boundary validation obligations (worker validates before persisting, API validates what it serves) and the result shape requirements are unchanged.

## Impact

- `apps/api`: `src/contract.ts` rewritten around Zod; Ajv/ajv-formats dropped; `zod` added; contract tests unchanged in structure (same fixture glob).
- `apps/worker`: `worker/contract.py` rewritten around pydantic models; `jsonschema` dropped; `pydantic` added; stub simplified to construct models.
- `contracts/`: schema file deleted; fixtures expanded.
- Dockerfiles: `COPY contracts` removed from runtime images (kept for test stages if needed).
- CI: no job structure changes; stack-job smoke command updated.
- Implemented on the `project-foundation` branch as part of PR #1, per reviewer decision.
