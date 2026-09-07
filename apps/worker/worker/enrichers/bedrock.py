"""Bedrock transport for the shared model enricher: one Converse call with a
forced tool call carrying the contract schema."""

from typing import Any

from worker import config
from worker.enrichers.model import PROMPT_VERSION, Completion, ModelEnricher
from worker.errors import EnricherError

TOOL_NAME = "record_enrichment"


class BedrockEnricher(ModelEnricher):
    prompt_version = f"bedrock-{PROMPT_VERSION}"

    def __init__(self, client: Any | None = None, model_id: str | None = None):
        self.model_id = model_id or config.bedrock_model_id()
        if not self.model_id:
            raise ValueError("BEDROCK_MODEL_ID is required when ENRICHER=bedrock")
        if client is None:
            import boto3  # deferred so the stub path never needs it

            client = boto3.client("bedrock-runtime")
        self._client = client

    def _complete(self, system: str, user: str, schema: dict[str, Any]) -> Completion:
        response = self._client.converse(
            modelId=self.model_id,
            system=[{"text": system}],
            messages=[{"role": "user", "content": [{"text": user}]}],
            toolConfig={
                "tools": [
                    {
                        "toolSpec": {
                            "name": TOOL_NAME,
                            "description": "Record the structured enrichment result.",
                            "inputSchema": {"json": schema},
                        }
                    }
                ],
                "toolChoice": {"tool": {"name": TOOL_NAME}},
            },
        )
        usage = response.get("usage", {})
        token_usage = {
            key: usage[source]
            for key, source in (("input_tokens", "inputTokens"), ("output_tokens", "outputTokens"))
            if isinstance(usage.get(source), int)
        }
        return Completion(payload=_tool_input(response), token_usage=token_usage)


def _tool_input(response: dict[str, Any]) -> Any:
    blocks = response.get("output", {}).get("message", {}).get("content", [])
    for block in blocks:
        tool_use = block.get("toolUse")
        if tool_use and tool_use.get("name") == TOOL_NAME:
            return tool_use.get("input")
    raise EnricherError("invalid_model_output", "response contains no record_enrichment tool call")
