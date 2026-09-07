# Ollama Enricher

## Why

The only real model behind the `Enricher` seam is Bedrock, so exercising the model path locally costs AWS credentials and money per link. An Ollama enricher lets the full pipeline run against a model on the developer's machine for free, and forces the split between the provider-agnostic prompt and the provider-specific transport that the next provider (OpenRouter) will need anyway.

## What Changes

- **Shared model-enricher base**: the prompt, contract schema with field guidance, content cap, tag normalization, strict validation, timing, and error classification move out of `BedrockEnricher` into one base class. Provider classes only build the request, make the call, and pull the JSON payload and token counts out of the provider's response shape.
- **Ollama enricher** selected by `ENRICHER=ollama`: one call to Ollama's own chat API with structured output constrained to the contract schema, a fixed context size that fits the content cap, deterministic sampling, and an explicit request timeout. Selected model and server URL come from `OLLAMA_MODEL` and `OLLAMA_BASE_URL`.
- **Provider-prefixed prompt versions**: Bedrock keeps `bedrock-v3`; Ollama uses `ollama-v3`. Same prompt generation, distinct idempotency keys, so re-enriching a link after switching provider stores a new row instead of hitting the existing one.
- **Compose and config wiring**: `.env.example` and the worker service gain the Ollama variables; in Compose the default URL points at the host machine, where Ollama runs.
- **Bedrock behavior unchanged**: identical request shape, identical `prompt_version`, existing tests keep passing.
- **Offline tests only**: Ollama is tested through a faked HTTP transport; CI never talks to a model.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `enrichment-contract`: the Bedrock-specific prompt requirement becomes a shared model-enricher prompt requirement; a new requirement adds the Ollama enricher behind the seam with its selection, structured-output, validation, and failure behavior; the metadata requirement gains Ollama's `prompt_version`.
- `job-processing`: the configuration requirement names the selected provider's settings (Bedrock model ID; Ollama base URL and model) instead of Bedrock alone.

## Impact

- **Worker** (`apps/worker`): new `worker/enrichers/model.py` (shared base) and `worker/enrichers/ollama.py`; `bedrock.py` shrinks to its transport; `base.py` factory accepts `ollama`; `config.py` gains two Ollama readers. No new dependencies: `httpx` is already present.
- **Config**: `.env.example`, `docker-compose.yml` worker environment plus a host-gateway entry so the container can reach Ollama on the host.
- **Docs**: README local-run section, runbook note on lease sizing and host networking for Ollama, CLAUDE.md enricher description.
- **Database, API, Bruno, CI shape**: untouched.

## Out of Scope

- OpenRouter or any OpenAI-shaped transport (next change; it will reuse the shared base).
- Running evals against Ollama, or gating anything on local model quality. Ollama is for local testing only.
- CI jobs that require a model, GPU support, or an Ollama service inside Compose.
- Thinking-mode models and Ollama's thinking parameter.
- Changes to the contract shape, the lease mechanism, or the idempotency key.
