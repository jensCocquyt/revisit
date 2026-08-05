"""The AI seam: an Enricher turns extracted content into a contract-valid result."""

import hashlib
from dataclasses import dataclass, field
from typing import Any, Protocol

from worker.contract import CONTRACT_VERSION

SAVE_INTENTS = ["reference", "read_later", "time_sensitive"]
RECOMMENDED_ACTIONS = ["none", "read_soon", "action", "revisit"]


@dataclass(frozen=True)
class EnrichmentInput:
    """Extracted page content plus the user's optional context."""

    content: str
    note: str | None = None
    goal: str | None = None


@dataclass(frozen=True)
class EnrichmentOutcome:
    result: dict[str, Any]
    model_id: str
    diagnostics: dict[str, Any] = field(default_factory=dict)


class Enricher(Protocol):
    def enrich(self, request: EnrichmentInput) -> EnrichmentOutcome: ...


class StubEnricher:
    """Deterministic offline enricher: same input, byte-identical result."""

    model_id = "stub"

    def enrich(self, request: EnrichmentInput) -> EnrichmentOutcome:
        digest = hashlib.sha256(
            "\x1f".join([request.content, request.note or "", request.goal or ""]).encode("utf-8")
        ).hexdigest()
        seed = int(digest[:8], 16)

        save_intent = SAVE_INTENTS[seed % len(SAVE_INTENTS)]
        recommended_action = RECOMMENDED_ACTIONS[(seed // 7) % len(RECOMMENDED_ACTIONS)]

        quote = request.content[:80].strip() or "empty content"
        result: dict[str, Any] = {
            "contract_version": CONTRACT_VERSION,
            "summary": f"Deterministic stub summary for content {digest[:12]}.",
            "key_takeaway": f"Stub takeaway derived from content {digest[:12]}.",
            "topics": [f"stub-topic-{digest[:4]}", f"stub-topic-{digest[4:8]}"],
            "suggested_group": f"stub-group-{digest[8:12]}",
            "save_intent": save_intent,
            "recommended_action": recommended_action,
            "evidence": [
                {
                    "quote": quote[:500],
                    "start_offset": 0,
                    "end_offset": len(quote[:500]),
                }
            ],
        }
        if recommended_action == "revisit":
            result["revisit"] = {
                "reason": f"Stub revisit reason derived from content {digest[:12]}.",
                "suggested_date": "2030-01-01",
            }
        return EnrichmentOutcome(result=result, model_id=self.model_id)


def get_enricher(name: str) -> Enricher:
    if name == "stub":
        return StubEnricher()
    raise ValueError(f"Unknown enricher: {name!r} (only 'stub' exists in MVP 1 foundation)")
