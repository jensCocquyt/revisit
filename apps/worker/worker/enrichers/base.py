"""The AI seam: an Enricher turns extracted content into a contract-valid result."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from worker.contract import NonRevisitResult, RevisitResult


@dataclass(frozen=True)
class EnrichmentInput:
    """Extracted page content plus the user's optional context."""

    content: str
    note: str | None = None
    goal: str | None = None


@dataclass(frozen=True)
class EnrichmentOutcome:
    result: NonRevisitResult | RevisitResult
    model_id: str
    latency_ms: int | None = None
    token_usage: dict[str, int] | None = None
    diagnostics: dict[str, Any] = field(default_factory=dict)


class Enricher(ABC):
    # Identifies the prompt/behavior generation in the enrichments idempotency
    # key; subclasses must set it and change it whenever their prompt changes.
    prompt_version: str

    @abstractmethod
    def enrich(self, request: EnrichmentInput) -> EnrichmentOutcome: ...


def get_enricher(name: str) -> Enricher:
    # Imported here to keep the seam module free of implementation imports and
    # boto3 out of the process unless Bedrock is actually selected.
    if name == "stub":
        from worker.enrichers.stub import StubEnricher

        return StubEnricher()
    if name == "bedrock":
        from worker.enrichers.bedrock import BedrockEnricher

        return BedrockEnricher()
    raise ValueError(f"Unknown enricher: {name!r} (expected 'stub' or 'bedrock')")
