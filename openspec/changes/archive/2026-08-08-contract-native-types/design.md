## Context

The foundation established one JSON Schema validated by Ajv (API) and `jsonschema` (worker), with six shared fixtures. It is correct but ergonomically poor: no static types anywhere, CJS interop hacks for Ajv 2020, dict-building in the stub, and both Dockerfiles must preserve an exact directory depth so `../../../contracts/` resolves at runtime. The decision (recorded in this change) is to trade the single neutral artifact for native definitions in each language, with the shared fixture suite as the drift detector. The contract's shape does not change.

## Goals / Non-Goals

**Goals:**
- Static types for the enrichment result in both languages, inferred from the validation definitions themselves.
- One validation idiom per language: Zod parse in TS, pydantic construction in Python.
- Fixtures as the enforceable cross-language conformance suite, with boundary-level coverage.
- Remove the runtime dependency on the `contracts/` directory and its path coupling.

**Non-Goals:**
- No change to contract fields, enums, or semantics (`contract_version` stays `"v1"`).
- No OpenAPI generation yet (PR 5 builds it on the Zod definition).
- No codegen or schema-emission pipeline — that is the alternative this change rejects.

## Decisions

### 1. Discriminated unions on `recommended_action` in both languages

The `revisit`-requires-reason-and-date invariant, previously an `if/then/else` branch, becomes structural:

- Zod: `z.discriminatedUnion("recommended_action", [...])` — three non-revisit variants share a base without `revisit`; the `revisit` variant requires it. Static type via `z.infer`.
- pydantic: `Annotated[NonRevisitResult | RevisitResult, Field(discriminator="recommended_action")]` with `Literal` action types.

The invariant moves from schema logic into the type system of each language — unrepresentable rather than validated-after-the-fact.

### 2. Strictness parity rules

The definitions must agree on the details JSON Schema previously pinned down centrally:

- Unknown fields rejected: `.strict()` in Zod, `model_config = ConfigDict(extra="forbid")` in pydantic.
- Same length/size limits, same enum values, same required/optional fields.
- `suggested_date`: ISO `YYYY-MM-DD` in both (Zod `z.string().date()`, pydantic `datetime.date` serialized as ISO string).
- No silent coercion: pydantic strict mode for scalars so `"5"` does not become `5` where Zod would reject it.

Parity is not enforced by tooling — it is enforced by the fixture suite, which is why fixture coverage is part of this change's definition of done.

### 3. Fixtures are the contract

`contracts/enrichment/fixtures/` keeps the `valid-*` / `invalid-*` naming convention and both suites keep globbing it (filename prefix decides the expected outcome, as today). Coverage expands to every rule that must stay in sync: each enum value, each length boundary (at and over), `revisit` present/absent for each action, empty and populated evidence, offset edge cases, unknown-field rejection, wrong-type rejection. A rule without a fixture is a rule that can silently diverge — review of this change should treat missing fixtures as bugs.

### 4. Validation entry points keep their signatures

`validateEnrichmentResult(result: unknown)` (TS) and `validate_enrichment_result(result)` (Python) keep name and error-list shape, now backed by Zod/pydantic internally, with one addition: the TS function returns the typed result on success. Call sites (tests, stack smoke command) survive mostly unchanged, and PR 2 consumes typed results from day one.

### 5. Runtime decoupling from `contracts/`

With validation in code, runtime images stop copying `contracts/`. Test code resolves fixtures relative to the repo checkout (as today). The Dockerfile depth constraint documented in CLAUDE.md disappears; CLAUDE.md is updated accordingly.

## Risks / Trade-offs

- [Definitions drift where no fixture exercises the difference] → The expanded boundary-level fixture suite is the mitigation and is in scope; additionally, from PR 2 the API Zod-validates worker-produced rows at read time, turning any residual drift into an observable runtime signal rather than silent corruption.
- [pydantic and Zod disagree on edge semantics (date parsing, strictness defaults)] → Strictness parity rules in Decision 2 are explicit; fixtures include the known divergence-prone cases (coercion, unknown fields, date formats).
- [Two definitions to touch on every contract evolution] → Accepted cost of the trade; the fixture suite fails loudly when one side is forgotten, and contract changes are rare and deliberate (versioned).
- [Deleting the schema loses the language-neutral artifact for future consumers] → If a third consumer appears, emit JSON Schema from one side (Zod v4 `z.toJSONSchema` or pydantic `model_json_schema`) as a build artifact then; no need to carry it now.

## Migration Plan

Lands inside PR #1 on the `project-foundation` branch: swap API validation, swap worker validation, expand fixtures, delete schema, update Dockerfiles/CLAUDE.md. No data migration (no persisted enrichments exist).

## Open Questions

None.
