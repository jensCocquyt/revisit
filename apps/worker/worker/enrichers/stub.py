"""Deterministic offline enricher: same input, identical result, no network."""

import hashlib
from datetime import date
from typing import Any, Literal

from worker.contract import (
    CONTRACT_VERSION,
    EvidenceItem,
    NonRevisitResult,
    RevisitResult,
    RevisitSuggestion,
)
from worker.enrichers.base import Enricher, EnrichmentInput, EnrichmentOutcome

SAVE_INTENTS: list[Literal["reference", "read_later", "time_sensitive"]] = [
    "reference",
    "read_later",
    "time_sensitive",
]
NON_REVISIT_ACTIONS: list[Literal["none", "read_soon", "action"]] = [
    "none",
    "read_soon",
    "action",
]


class StubEnricher(Enricher):
    model_id = "stub"
    prompt_version = "stub-v1"

    def enrich(self, request: EnrichmentInput) -> EnrichmentOutcome:
        digest = hashlib.sha256(
            "\x1f".join([request.content, request.note or "", request.goal or ""]).encode("utf-8")
        ).hexdigest()
        seed = int(digest[:8], 16)

        save_intent = SAVE_INTENTS[seed % len(SAVE_INTENTS)]
        action_index = (seed // 7) % 4

        quote = request.content[:80].strip() or "empty content"
        common: dict[str, Any] = {
            "contract_version": CONTRACT_VERSION,
            "summary": f"Deterministic stub summary for content {digest[:12]}.",
            "key_takeaway": f"Stub takeaway derived from content {digest[:12]}.",
            "topics": [f"stub-topic-{digest[:4]}", f"stub-topic-{digest[4:8]}"],
            "suggested_group": f"stub-group-{digest[8:12]}",
            "save_intent": save_intent,
            "evidence": [
                EvidenceItem(quote=quote[:500], start_offset=0, end_offset=len(quote[:500]))
            ],
        }
        result: NonRevisitResult | RevisitResult
        if action_index == 3:
            result = RevisitResult(
                **common,
                recommended_action="revisit",
                revisit=RevisitSuggestion(
                    reason=f"Stub revisit reason derived from content {digest[:12]}.",
                    suggested_date=date(2030, 1, 1),
                ),
            )
        else:
            result = NonRevisitResult(
                **common, recommended_action=NON_REVISIT_ACTIONS[action_index]
            )
        return EnrichmentOutcome(result=result, model_id=self.model_id)
