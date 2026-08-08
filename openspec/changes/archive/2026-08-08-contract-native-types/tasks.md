## 1. Expand the fixture suite

- [x] 1.1 Add boundary fixtures to `contracts/enrichment/fixtures/`: each save intent and recommended action value, `revisit` present on non-revisit actions (invalid), length limits at and over the maximum, empty evidence, offset edge cases, unknown top-level and nested fields (invalid), wrong-type values (invalid)

## 2. API: Zod contract

- [x] 2.1 Replace `src/contract.ts` with a Zod discriminated union on `recommended_action` (strict objects, same limits and enums as the schema), export the inferred `EnrichmentResult` type, keep the `validateEnrichmentResult` signature returning typed data on success
- [x] 2.2 Remove `ajv` and `ajv-formats` dependencies; add `zod`
- [x] 2.3 Verify the fixture-glob contract tests pass against the expanded suite

## 3. Worker: pydantic contract

- [x] 3.1 Replace `worker/contract.py` with pydantic models (discriminated union on `recommended_action`, `extra="forbid"`, strict scalars, ISO date), keeping the validation entry point's name and error-list behavior
- [x] 3.2 Update `StubEnricher` to construct and return the pydantic model instead of a dict
- [x] 3.3 Remove the `jsonschema` dependency; add `pydantic`
- [x] 3.4 Verify fixture-glob tests and stub determinism/validity tests pass against the expanded suite

## 4. Decouple runtime from contracts directory

- [x] 4.1 Delete `contracts/enrichment/v1.schema.json`
- [x] 4.2 Remove `COPY contracts` from both Dockerfiles and drop the schema-path resolution; confirm fixtures resolve from the repo checkout in tests only
- [x] 4.3 Update the CI stack-job smoke command to validate the stub result via the pydantic entry point

## 5. Verify and document

- [x] 5.1 Run both workspaces' format, lint, and test commands; rebuild the Compose stack to healthy
- [x] 5.2 Update CLAUDE.md (contract seam section: native definitions, fixtures-as-contract, no path coupling) and the PR #1 description
