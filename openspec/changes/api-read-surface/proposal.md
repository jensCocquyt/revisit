# API read surface: list links and expose the stored enrichment

## Why

The pipeline produces tags, evidence-backed summaries, and deadlines, but the API exposes none of it: `GET /links/:id` returns the link row alone, and the cloud demo inspects results with SQL against RDS. A browser UI is the stated next step and needs two things the API cannot give it today: a paginated, filterable list of the library, and the analysis behind each link. Adding them now, with contract v2 semantics, also removes the demo's operator database dependency for inspection.

## What Changes

- **New `GET /links/:id/enrichment`**: serves the latest stored enrichment for a link. The stored `result` is validated with the existing Zod contract before serving; evidence items (and a deadline's `source`) whose quote does not appear in the stored extracted text are dropped, so evidence is shown only when it resolves. A link without an enrichment yet returns 404 with a distinct error code.
- **New `GET /links`**: keyset-paginated listing, newest first, filterable by `status` and by a single `tag` matched against the latest enrichment's tags. Returns `items` plus an opaque `next_cursor`. This is the build spec's step-8 listing translated from the retired v1 taxonomy (intent/action/topic/group) to v2 semantics (status, tags).
- **Link representation gains `tags` and `deadline`** (the date only), drawn from the latest valid enrichment; empty list and `null` when there is none. `GET /links/:id`, `POST /links`, and list items share this one shape, so a list view can render and filter by tag without one call per row. The full analysis (summary, evidence, deadline reason and source) stays on the enrichment endpoint.
- **CORS, opt-in by configuration**: a `CORS_ORIGINS` variable (comma-separated exact origins) enables cross-origin access for a browser client. Unset means no CORS headers, which stays the default locally and in the cloud until a UI exists. Preflight requests succeed without the API key. Plumbed through `.env.example` and a Terraform variable with an empty default.
- **API-key coverage extended**: both new routes sit behind the existing `x-api-key` middleware, asserted by tests.
- **OpenAPI and Bruno updated together**: the OpenAPI document describes both endpoints and the new fields; `bruno/` gains requests for both, each with a cloud-run note; the parity test keeps them in sync.
- **Demo simplification**: `scripts/demo-cloud.sh` inspects enrichments through the API instead of `psql`; `docs/demo.md` follows. `DATABASE_URL` remains required only for the job-row inspection and requeue steps.

New infrastructure: none. No schema migration; the listing and tag filter query existing tables.

## Capabilities

### New Capabilities

- `link-reading`: reading the library through the API: the paginated, filterable list; the enrichment endpoint with contract validation and evidence resolution at the serving boundary; opt-in cross-origin access.

### Modified Capabilities

- `link-capture`: the stored link representation gains `tags` and `deadline`; the OpenAPI document and the Bruno collection cover the two new endpoints.

## Impact

- `apps/api/src/app.ts`: CORS middleware, two route registrations, `CORS_ORIGINS` option.
- `apps/api/src/routes/links/`: new `list-links.ts` and `get-enrichment.ts`; `shared.ts` link shape gains facets derived from a validated result.
- `apps/api/src/db/`: `listLinks`, `getEnrichment`, latest-enrichment join in `getLink`; `Db` interface and test fakes.
- `apps/api/test/`: new route tests (unit with fakes, integration against PostgreSQL), OpenAPI path assertions, API-key coverage, Bruno parity.
- `bruno/`: two new requests; `docs/demo.md` Bruno section.
- `scripts/demo-cloud.sh`, `docs/demo.md`: SQL inspection replaced by the enrichment endpoint.
- `.env.example`, `terraform/stack/variables.tf`, `terraform/stack/ecs.tf`: `CORS_ORIGINS`.
- `README.md`: endpoint list.
- After merge: redeploy via the Deploy workflow and verify both endpoints in Swagger UI at the cloud URL.

## Out of Scope

- The browser UI itself.
- Authentication beyond the existing static API key; the key in a browser remains spend protection, not auth.
- Search, embeddings, similarity.
- Multi-tag filters, sorting options, derived time views (`upcoming`, `expired`); one tag filter and newest-first ordering are enough for the first UI.
- Exposing extracted page text or enrichment history (only the latest enrichment is served).
- Migrating or serving stored results that predate contract v2; an invalid stored result is reported, not repaired.
