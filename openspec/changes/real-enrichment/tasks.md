## 1. Failure taxonomy and dependencies

- [x] 1.1 Add `httpx`, `trafilatura`, and `boto3` to `apps/worker/pyproject.toml`; `uv sync`; commit lockfile
- [x] 1.2 Define `FetchTerminalError(code, detail)` and `FetchTransientError(code, detail)` (in `worker/fetch.py`) with the stable codes from design §1; unit-test `str()` formatting matches the `"code: detail"` `last_error` shape
- [x] 1.3 Extend `_fail` in `worker/jobs.py` with `terminal: bool = False` forcing the immediate job+link `failed` branch regardless of attempts; unit/integration test: terminal failure records `attempts = 1`, no reschedule, link `failed`

## 2. Safe fetching (`worker/fetch.py`)

- [x] 2.1 URL validation + address guard with injectable resolver: scheme allowlist, literal-IP and resolved-address checks via `ipaddress` (loopback, private, link-local, multicast, unspecified, reserved), `FETCH_ALLOWED_HOSTS` exact-match bypass of the address check only
- [x] 2.2 Offline guard-matrix tests with a fake resolver: metadata IP, private, loopback (v4+v6), multicast, unspecified, public-allowed, allowlisted host, `ftp://`, unparseable URL, DNS failure → transient
- [x] 2.3 Guarded fetch loop: manual redirect handling revalidating every hop, `FETCH_MAX_REDIRECTS`, total-duration budget, `Content-Length` pre-check plus streamed size abort (`FETCH_MAX_BYTES`), content-type allowlist, status/connection/timeout → transient codes
- [x] 2.4 Fetch tests via httpx `MockTransport`: redirect-to-blocked, redirect chain over limit, valid redirect success, oversize body, `application/pdf` rejected, 429/503/timeout transient — all offline
- [x] 2.5 Add fetch env vars to `worker/config.py` with design §9 defaults; config unit tests

## 3. Extraction and content versions

- [x] 3.1 `worker/extract.py`: trafilatura-based `ExtractedContent(text, title, metadata)`, sha256 `content_hash`, empty text → `FetchTerminalError("empty_content")`
- [x] 3.2 Add fixed HTML snapshot fixtures under `apps/worker/tests/`; tests: determinism (byte-identical twice), boilerplate excluded, title captured, empty page terminal
- [x] 3.3 `store_content_version(conn, link_id, extracted)` — short transaction, `ON CONFLICT (link_id, content_hash) DO NOTHING` + select id; integration tests: create, identical re-store reuses row, changed text creates second version

## 4. Enricher seam updates

- [x] 4.1 Add `prompt_version` class attribute to `Enricher`, `"stub-v1"` on `StubEnricher`; add `latency_ms` / `token_usage` (default `None`) to `EnrichmentOutcome`; delete the `PROMPT_VERSION` constant from `jobs.py`
- [x] 4.2 Update `get_enricher` to accept `"bedrock"` (lazy import) while rejecting unknown names; tests for selection and stub-still-default

## 5. Pipeline wiring and evidence verification

- [x] 5.1 `worker/evidence.py`: resolution per design §7 (exact slice → verbatim `find` repair → drop), returning verified result + drop count; unit tests: exact match kept, offsets repaired, unresolvable dropped, empty-evidence result passes
- [x] 5.2 Rewrite `process_one`: fetch → extract → store version → enrich over extracted text → verify evidence → `_complete`, catching `FetchTerminalError` (terminal) and `FetchTransientError`/enricher errors (transient); no transaction open during fetch or enrich
- [x] 5.3 Extend `_complete` to persist `content_version_id`, extracted-text `content_hash`, enricher `prompt_version`, `model_id`, `latency_ms`, `token_usage`; log `evidence_dropped` count when > 0
- [x] 5.4 Integration tests (fake transport + resolver, stub enricher): happy path stores linked content version + enrichment; blocked URL terminal with stable `last_error` and no retry; timeout reschedules with backoff; identical reprocessing reuses content version and hits the enrichment conflict path; persisted evidence slices equal quotes
- [x] 5.5 Update `worker/smoke.py` if needed so the in-container contract smoke still passes with the seam changes

## 6. Bedrock enricher (`worker/bedrock.py`)

- [x] 6.1 Implement `BedrockEnricher` per design §6: single Converse call, static system prompt, note/goal + delimited `<page_content>` in the user message, content truncated to the fixed char budget, forced tool with schema derived from the pydantic contract
- [x] 6.2 Strict JSON-mode contract validation of the tool input; missing tool call / invalid output / SDK errors raise transient errors; outcome carries `model_id`, measured `latency_ms`, `token_usage`; `prompt_version = "bedrock-v1"`
- [x] 6.3 Faked-client tests: valid response → validated outcome with metadata; contract-invalid response → transient; page text containing "ignore your instructions" never appears in the system prompt (assert request shape)

## 7. Configuration, CI, and verification

- [x] 7.1 Add fetch + Bedrock vars to `.env.example` and `docker-compose.yml` worker environment (stub and empty allowlist defaults); confirm defaults boot with zero edits
- [x] 7.2 Update the CI stack check: CI-only nginx `fixture` service (compose `ci` profile) serving the article snapshot, `FETCH_ALLOWED_HOSTS=fixture` in the CI env only, check posts `http://fixture/` (the `/docs` Swagger page from the design draft is an empty JS shell — it would extract to `empty_content`); verify the API accepts that URL through `POST /links` validation
- [x] 7.3 Run full offline verification: `uv run ruff format --check .`, `uv run ruff check .`, `uv run pytest`, API `npm run lint` + `npm test` (untouched but must stay green), compose stack save → enriched on the stub
- [ ] 7.4 Manual Bedrock verification per design §Migration: real public URL with `ENRICHER=bedrock` reaches `enriched`; SQL-check `content_version_id` resolves and every evidence slice equals its quote; blocked destination (`http://169.254.169.254/`) fails immediately with stable `last_error`; record the commands and results in the PR description
