## 1. Shared model-enricher base (`worker/enrichers/model.py`)

- [x] 1.1 Create `ModelEnricher(Enricher)` ABC with concrete `enrich` (build prompt, time `_complete`, wrap non-`EnricherError` exceptions as `enrich_error`, normalize tags, `parse_result` failure as `invalid_model_output`, assemble `EnrichmentOutcome`) and the `Completion(payload, token_usage)` dataclass; abstract `_complete(system, user, schema)`
- [x] 1.2 Move `SYSTEM_PROMPT`, `MAX_CONTENT_CHARS`, `MAX_VOCABULARY_TAGS`, `PROMPT_VERSION = "v3"`, and the system-prompt, user-message, and schema builders from `bedrock.py` into `model.py` unchanged in output
- [x] 1.3 New `tests/test_model_enricher.py`: system prompt states tag, deadline, and truncation discipline; vocabulary lands in the system prompt and never in the page section; page text with "ignore your instructions" stays inside the delimiters; content truncated to the cap by prefix; empty vocabulary wording; a `_complete` raising a plain exception surfaces as `enrich_error`, an `EnricherError` passes through unchanged
- [x] 1.4 Run `uv run pytest tests/test_model_enricher.py`

## 2. Bedrock on the shared base

- [x] 2.1 Rewrite `BedrockEnricher` as a `ModelEnricher` subclass: `_complete` builds the Converse call with the forced tool from the passed schema, extracts the tool input, maps `inputTokens`/`outputTokens`; `prompt_version = "bedrock-v3"` kept literally
- [x] 2.2 Update `tests/test_bedrock.py` imports; drop prompt-content tests now covered by 1.3; keep request-shape, tool-input, usage, missing-tool-call, and invalid-output tests; confirm the Converse request kwargs are unchanged
- [x] 2.3 Run `uv run pytest tests/test_bedrock.py tests/test_enricher.py`

## 3. Ollama enricher (`worker/enrichers/ollama.py`)

- [x] 3.1 Add `ollama_base_url()` (default `http://localhost:11434`) and `ollama_model()` (default empty) to `config.py`; extend `tests/test_config.py` defaults and env tests
- [x] 3.2 Implement `OllamaEnricher(ModelEnricher)`: constructor takes optional `httpx.Client`, `base_url`, `model`, raising `ValueError` naming `OLLAMA_MODEL` when the model is empty; `_complete` posts to `/api/chat` with `stream: false`, `format` = schema, `options` `num_ctx` 8192 and `temperature` 0, system and user messages, 300 s timeout; decodes `message.content` JSON (decode failure is `invalid_model_output`); maps `prompt_eval_count`/`eval_count` to token usage; `prompt_version = "ollama-v3"`
- [x] 3.3 Add `ollama` to `get_enricher` with a lazy import and update the unknown-name message; update the `enrichers` package docstring
- [x] 3.4 New `tests/test_ollama.py` with `httpx.MockTransport`: request path, `format` equals the contract schema, `num_ctx` 8192, messages carry the shared prompt; valid JSON reply yields validated outcome with `model_id`, latency, usage, and `ollama-v3`; non-JSON content and contract-invalid JSON raise `invalid_model_output`; HTTP 500 and `httpx.ConnectError` raise `enrich_error`; empty model raises at construction
- [x] 3.5 Extend `tests/test_enricher.py`: factory returns `OllamaEnricher` for `ollama` (with a model set), unknown names still rejected
- [x] 3.6 Run `uv run pytest tests/test_ollama.py tests/test_config.py tests/test_enricher.py`

## 4. Configuration, Compose, and docs

- [x] 4.1 Add `OLLAMA_BASE_URL` and `OLLAMA_MODEL` to `.env.example` under an Ollama section noting the model must support at least 8192 context tokens and that `WORKER_LEASE_SECONDS` should be raised for CPU inference
- [x] 4.2 Wire both variables into the `docker-compose.yml` worker environment with `OLLAMA_BASE_URL` defaulting to `http://host.docker.internal:11434`, and add `extra_hosts: host.docker.internal:host-gateway` to the worker service
- [x] 4.3 Docs: README local-run paragraph mentions `ENRICHER=ollama`; runbook gains a short "Running against local Ollama" section (host networking on Linux, loopback binding, lease sizing); CLAUDE.md enricher description lists `ollama.py` and the shared `model.py`
- [x] 4.4 Grep the diff for em dashes and spec references; check every new comment earns its place

## 5. Verification

- [x] 5.1 Full offline suite: `uv run ruff format --check .`, `uv run ruff check .`, `uv run pytest`; API `npm run lint` and `npm test` untouched but green
- [x] 5.2 Compose stack on the stub still reaches enriched with an unedited `.env.example` (stack CI path unchanged)
- [x] 5.3 Manual Ollama verification with Ollama running locally, `ENRICHER=ollama`, `OLLAMA_MODEL=llama3.2`: save a real public URL through the Compose stack, confirm the link reaches `enriched`, the enrichments row carries `ollama-v3` and the model id, every persisted evidence slice equals its quote; record commands and results in the PR description
