"""Ollama transport for the shared model enricher: one chat call to a local
Ollama server with the reply constrained to the contract schema."""

import json
from typing import Any

import httpx

from worker import config
from worker.enrichers.model import PROMPT_VERSION, Completion, ModelEnricher
from worker.errors import EnricherError

# Must hold MAX_CONTENT_CHARS of page text plus the prompt and the reply;
# Ollama trims silently when the request exceeds it.
NUM_CTX = 8192
REQUEST_TIMEOUT_SECONDS = 300.0


class OllamaEnricher(ModelEnricher):
    prompt_version = f"ollama-{PROMPT_VERSION}"

    def __init__(self, client: httpx.Client | None = None, model: str | None = None):
        self.model_id = model or config.ollama_model()
        if not self.model_id:
            raise ValueError("OLLAMA_MODEL is required when ENRICHER=ollama")
        if client is None:
            client = httpx.Client(
                base_url=config.ollama_base_url(), timeout=REQUEST_TIMEOUT_SECONDS
            )
        self._client = client

    def _complete(self, system: str, user: str, schema: dict[str, Any]) -> Completion:
        response = self._client.post(
            "/api/chat",
            json={
                "model": self.model_id,
                "stream": False,
                "format": schema,
                "options": {"num_ctx": NUM_CTX, "temperature": 0},
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            },
        )
        response.raise_for_status()
        body = response.json()
        content = body.get("message", {}).get("content", "")
        try:
            payload = json.loads(content)
        except json.JSONDecodeError as exc:
            raise EnricherError(
                "invalid_model_output", f"reply is not JSON: {content[:100]!r}"
            ) from exc
        token_usage = {
            key: body[source]
            for key, source in (
                ("input_tokens", "prompt_eval_count"),
                ("output_tokens", "eval_count"),
            )
            if isinstance(body.get(source), int)
        }
        return Completion(payload=payload, token_usage=token_usage)
