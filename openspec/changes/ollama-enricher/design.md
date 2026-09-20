# Ollama Enricher: Design

## Context

`BedrockEnricher` currently owns two unrelated things: the provider-agnostic prompt (system instructions, vocabulary placement, delimited untrusted page text, schema field guidance, content cap, tag normalization, strict validation, error codes) and the Bedrock transport (boto3 Converse, forced tool call, response walking, usage keys). Adding a second provider by copying the file would create two prompts that drift.

Observed on the owner's machine (Ollama 0.17.1, `llama3.2` 3B, CPU only, 64 GB RAM): Ollama's `/api/chat` accepts the pydantic-generated contract schema as its `format` argument unchanged (nullable `deadline` via `anyOf`, strict objects, `$defs`), the model returned a contract-valid result on the first try, evidence quotes were verbatim but their offsets were wrong (the worker already repairs those), and latency was 46 s cold and 22 s warm for a four-sentence page.

Constraints: stub stays the default and the only CI path; no model network access in tests; Bedrock behavior and `prompt_version` must not change; no speculative abstraction beyond what two concrete providers need.

## Goals / Non-Goals

**Goals:**
- One prompt shared by every model-backed enricher, versioned once.
- `ENRICHER=ollama` runs the full pipeline against a local model with no code change.
- Provider modules stay small: request shape, call, payload and usage extraction.
- Bedrock tests pass unchanged apart from import paths.

**Non-Goals:**
- OpenRouter or OpenAI-shaped transport (next change).
- Evals, quality gates, or CI runs against Ollama.
- Thinking models, GPU configuration, Ollama inside Compose.
- Changing the lease mechanism or the enrichments idempotency key.

## Decisions

### 1. Template-method base class `ModelEnricher`

New `worker/enrichers/model.py` holds `ModelEnricher(Enricher)`, an ABC. Its `enrich` is concrete and does, in order: build system prompt and user message, derive the tool schema, time the call to the abstract `_complete(system, user, schema)`, wrap any non-`EnricherError` exception as `enrich_error`, normalize tags, `parse_result` (validation failure becomes `invalid_model_output`), and assemble `EnrichmentOutcome`. `_complete` returns a small frozen dataclass `Completion(payload: Any, token_usage: dict[str, int] | None)`.

The constants `SYSTEM_PROMPT`, `MAX_CONTENT_CHARS`, `MAX_VOCABULARY_TAGS`, and the helpers that build the system prompt, user message, and schema move here from `bedrock.py`. The base carries `PROMPT_VERSION = "v3"` as the shared prompt generation; each subclass sets `prompt_version` to `"<provider>-v3"` (decision 3).

Alternatives: a `prompt.py` module of free functions plus provider classes that each call them (leaves timing, error wrapping, and validation duplicated per provider); a single OpenAI-shaped enricher for Ollama (rejected in decision 2). An ABC matches the owner's stated preference over `Protocol`.

### 2. Ollama's own chat API, not its OpenAI-compatible endpoint

`worker/enrichers/ollama.py` posts to `<base_url>/api/chat` with `stream: false`, `format` set to the contract schema, `options: {"num_ctx": 8192, "temperature": 0}`, and the system and user messages. The reply's `message.content` is a JSON string; it is decoded into the payload. Token usage maps `prompt_eval_count` to `input_tokens` and `eval_count` to `output_tokens`.

Why not `/v1/chat/completions`: that endpoint has no way to set `num_ctx`. Ollama's default context is 4096 tokens and the content cap is 30,000 characters (about 7,500 tokens); overflow is trimmed silently on Ollama's side. `num_ctx` is a local-Ollama quirk, so it lives only in this module. Hosted providers run models at their full published window and reject oversized prompts with an error, so the future OpenAI-shaped transport needs nothing here.

`num_ctx` is a constant, not an environment variable: 8192 is sized to the content cap plus prompt and answer, not to any machine, and the two numbers that must agree sit next to each other. Temperature 0 keeps local runs as repeatable as the model allows. The thinking parameter is not sent: models without the capability reject it.

Transport is `httpx` (already a dependency); no Ollama SDK. The client is injectable so tests use `httpx.MockTransport`, the same pattern as the safe-fetch tests. A fixed request timeout of 300 s bounds a stuck server; latency on CPU is expected to exceed the default 60 s lease, which is harmless with one worker and documented in the runbook rather than solved here.

### 3. Provider-prefixed `prompt_version`

The enrichments unique key is `(link_id, content_hash, prompt_version)` and does not include `model_id`. With a shared `v3`, re-running a link after switching provider would hit the conflict and be treated as already done. Bedrock keeps `bedrock-v3` (spec-pinned, no behavior change); Ollama uses `ollama-v3`. The suffix is the shared prompt generation and must bump together across providers when the prompt changes.

### 4. Failure classification

All failures stay inside the existing `EnricherError` codes, so `jobs.py` is untouched:
- HTTP error status, connection refused, timeout: `enrich_error` (transient, bounded backoff, three attempts).
- Reply content that is not JSON, or a JSON payload that fails the contract: `invalid_model_output` (transient).
- Missing `OLLAMA_MODEL` with `ENRICHER=ollama`: `ValueError` at startup, mirroring `BEDROCK_MODEL_ID`.

Delivery guarantees are unchanged: at-least-once processing, idempotent persistence on the unique key.

### 5. Configuration and Compose

`config.py` gains `ollama_base_url()` (default `http://localhost:11434`, for running the worker directly on the host) and `ollama_model()` (default empty, required when selected). The Compose worker service defaults `OLLAMA_BASE_URL` to `http://host.docker.internal:11434` and adds `extra_hosts: host.docker.internal:host-gateway` so the name also resolves on Linux engines; on Docker Desktop it is harmless. `get_enricher` accepts `ollama` with the same lazy import pattern as Bedrock.

### 6. Tests

- Prompt-building tests (decision criteria in the system prompt, vocabulary in the instruction block, page text only inside the delimited section, truncation at the cap) move to a base-level test module and run once.
- `test_bedrock.py` keeps its faked client and asserts the Converse request shape, tool-input extraction, usage mapping, and `bedrock-v3`.
- New `test_ollama.py` uses `httpx.MockTransport`: request goes to `/api/chat` with `format` equal to the contract schema and `num_ctx` 8192; valid JSON content yields a validated outcome with usage and `ollama-v3`; non-JSON content and contract-invalid JSON raise `invalid_model_output`; HTTP 500 and connection errors raise `enrich_error`; missing model raises at construction.
- `test_config.py` covers the two new readers; `test_enricher.py` covers factory selection.

## Risks / Trade-offs

- [Model context smaller than 8192] The chosen model must support at least 8192 tokens; `llama3.2` supports 131k. A smaller model trims silently on Ollama's side. Mitigation: document the requirement in `.env.example`.
- [Non-verbatim quotes from small models] Evidence that does not resolve is dropped, and a dropped deadline source drops the deadline. This is existing, intended behavior; Ollama is for local testing, not quality claims.
- [Latency beyond the lease] CPU inference on a real article takes minutes; a second worker could reclaim the job after 60 s. Mitigation: runbook advises raising `WORKER_LEASE_SECONDS` for Ollama; the request timeout bounds the worst case; persistence is idempotent regardless.
- [Host networking on Linux] `host.docker.internal` needs the host-gateway entry, and Ollama must bind to `0.0.0.0` rather than loopback. Mitigation: both documented in the runbook; Docker Desktop needs neither.
- [Bedrock regression while extracting the base] Mitigation: keep the Bedrock request builder byte-for-byte equivalent and let the existing request-shape tests prove it.

## Migration Plan

No data or schema migration. Stub remains the default; Bedrock rows keep `bedrock-v3`. Rollback is `ENRICHER=stub`.

Manual verification before merge, recorded in the PR: with Ollama running locally and `ENRICHER=ollama`, `OLLAMA_MODEL=llama3.2`, save a real public URL and confirm the link reaches `enriched`, the enrichments row carries `ollama-v3` and the model id, and every persisted evidence slice equals its quote.

## Open Questions

None. Provider choice, prompt versioning, context size, and scope were settled in exploration.
