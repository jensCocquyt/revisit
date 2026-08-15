# Real Enrichment

## Why

The worker claims, leases, and retries jobs, but enriches stand-in content: the link URL is the "content", `content_hash = sha256(url)`, `content_version_id` is NULL, `prompt_version` is a hardcoded `"stub-v1"`, and every failure retries. The product promise — a grounded analysis of what the page actually says — requires fetching the real page. This is build-spec PR 3: safe fetching, readable-text extraction, versioned content storage, Bedrock behind the existing AI seam, and evidence verified against stored text.

## What Changes

- **Safe fetching** in a new worker module: HTTP/HTTPS only, DNS resolved before connecting, loopback/private/link-local/multicast/cloud-metadata ranges blocked, every redirect target revalidated, limits on redirect count, response size, duration, and content type. Limits configurable via env vars with defaults in `.env.example` and Compose.
- **Terminal vs transient failure taxonomy** (build-spec §3): blocked destination, unsupported content type, size violation, and invalid URL fail the job and link immediately with a stable `last_error` code and no retries; timeouts, rate limits, upstream 5xx, and invalid model output keep the existing bounded backoff. Implemented by extending the existing `_fail` path — no generic error framework.
- **Readable-text extraction** with title/metadata; `content_hash` computed over the extracted text; stored in `content_versions` using the existing `(link_id, content_hash)` unique key so an identical re-fetch reuses the existing version.
- **Real pipeline in `process_one`**: fetch and model call run outside database transactions; `enrichments` rows now carry a real `content_version_id`, a prompt version sourced from the enricher (no more module constant), plus `model_id`, `latency_ms`, and `token_usage`. The `EnrichmentOutcome` seam gains the fields needed to carry them.
- **Bedrock enricher** as an `Enricher` subclass in its own module, selected by `ENRICHER=bedrock`: one structured-output call, strict contract validation, invalid output is a retryable failure. System instructions stay separate from page content and from the user's note/goal — page text is untrusted data, never instructions.
- **Evidence verification** before persistence: each evidence item's offsets and quote must resolve against the stored extracted text; unresolvable items are dropped (never guessed) and the drop count is logged.
- **Offline tests only**: SSRF guard matrix with an injectable resolver, redirect revalidation, limit enforcement, extraction determinism from fixed HTML snapshots, `content_versions` dedupe, terminal-vs-transient classification, evidence resolution/drop cases, stub path green end to end. Bedrock is tested through a faked client. CI shape unchanged: no live network, no AWS credentials; the stack job's save → enriched check keeps passing on the stub.

**BREAKING** (internal only): the stub path's stored enrichments change meaning — `content_hash` becomes a hash of extracted text and `content_version_id` becomes non-null. No API surface changes.

## Capabilities

### New Capabilities

- `safe-fetching`: SSRF-guarded HTTP fetching — scheme allowlist, pre-connect DNS resolution and IP blocklist, redirect revalidation, and enforced limits on redirects, size, duration, and content type, with a stable failure classification for each violation.
- `content-extraction`: readable-text extraction from fetched HTML — title/metadata capture, deterministic `content_hash` over extracted text, versioned storage in `content_versions` with dedupe on identical content.

### Modified Capabilities

- `job-processing`: requirement "Stub enrichment over stand-in content" is replaced by the real pipeline (fetch → extract → enrich → verify → persist with `content_version_id`); failure handling splits into terminal vs transient; persistence gains `model_id`, `latency_ms`, `token_usage`, and enricher-sourced `prompt_version`; evidence verification before persistence; processing configuration extends to fetch limits and Bedrock settings.
- `enrichment-contract`: the enricher seam gains a Bedrock implementation selected by `ENRICHER=bedrock` (factory currently hard-rejects everything but `stub`); the `EnrichmentOutcome` seam carries latency and token usage; prompt separation rules for untrusted page content become spec-level behavior. The result contract shape itself does not change.

## Impact

- **Worker** (`apps/worker`): new modules for fetching, extraction, and the Bedrock enricher; `jobs.py` pipeline rewrite inside `process_one`/`_complete`/`_fail`; `enricher.py` outcome dataclass extended; `config.py` gains fetch-limit and Bedrock env vars. New dependencies: an HTTP client (httpx), an extraction library, and `boto3` for Bedrock.
- **Database**: no schema change — `content_versions` and the unused `enrichments` columns (`content_version_id`, `latency_ms`, `token_usage`) finally get writers.
- **Config**: `.env.example` and `docker-compose.yml` gain fetch-limit vars and document `ENRICHER=bedrock` + AWS settings; stub remains the default everywhere.
- **API / Bruno**: untouched — no new routes, no contract shape change.
- **CI**: same three jobs, still fully offline on the stub.

## Out of Scope

- Labelled evaluation set, metrics, requeue runbook (PR 4).
- `GET /links` list/filter endpoint or any API change; Bruno collection untouched.
- Raw HTML retention, object storage, embeddings, brokers.
- Contract shape changes unless proven necessary (if needed: both native definitions + boundary fixtures in the same commit).
- Executing page JavaScript; browser-based rendering.
