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
    diagnostics: dict[str, Any] = field(default_factory=dict)


class Enricher(ABC):
    @abstractmethod
    def enrich(self, request: EnrichmentInput) -> EnrichmentOutcome: ...


def get_enricher(name: str) -> Enricher:
    # Imported here to keep the seam module free of implementation imports.
    from worker.stub import StubEnricher

    if name == "stub":
        return StubEnricher()
    raise ValueError(f"Unknown enricher: {name!r} (only 'stub' exists in MVP 1 foundation)")
