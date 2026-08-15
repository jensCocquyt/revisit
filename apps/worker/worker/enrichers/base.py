"""The AI seam: an Enricher turns extracted content into a contract-valid result."""

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from worker.contract import TAG_MAX_LENGTH, TAGS_MAX_COUNT, EnrichmentResult

_WHITESPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class EnrichmentInput:
    """Extracted page content plus the user's optional context.

    `known_tags` is the library's existing tag vocabulary (most frequent
    first, possibly empty) for closed-world tag assignment. It is trusted
    user data, unlike `content`.
    """

    content: str
    note: str | None = None
    goal: str | None = None
    known_tags: tuple[str, ...] = ()


@dataclass(frozen=True)
class EnrichmentOutcome:
    result: EnrichmentResult
    model_id: str
    latency_ms: int | None = None
    token_usage: dict[str, int] | None = None
    diagnostics: dict[str, Any] = field(default_factory=dict)


def normalize_tags(raw: list[str]) -> list[str]:
    """Normalize model-produced tags before strict contract validation:
    lowercase, trim, collapse internal whitespace, drop empties/overlong,
    dedupe preserving order, cap at the contract maximum."""
    seen: list[str] = []
    for tag in raw:
        cleaned = _WHITESPACE.sub(" ", str(tag).strip().lower())
        if not cleaned or len(cleaned) > TAG_MAX_LENGTH:
            continue
        if cleaned not in seen:
            seen.append(cleaned)
    return seen[:TAGS_MAX_COUNT]


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
