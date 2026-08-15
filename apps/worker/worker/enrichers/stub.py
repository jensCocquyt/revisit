"""Deterministic offline enricher: same input, identical result, no network."""

import hashlib
from datetime import date, timedelta

from worker.contract import CONTRACT_VERSION, Deadline, EnrichmentResult, EvidenceItem
from worker.enrichers.base import Enricher, EnrichmentInput, EnrichmentOutcome


class StubEnricher(Enricher):
    model_id = "stub"
    prompt_version = "stub-v2"

    def enrich(self, request: EnrichmentInput) -> EnrichmentOutcome:
        digest = hashlib.sha256(
            "\x1f".join(
                [request.content, request.note or "", request.goal or "", *request.known_tags]
            ).encode("utf-8")
        ).hexdigest()
        seed = int(digest[:8], 16)

        # Prefer the provided vocabulary, like a real enricher would.
        if request.known_tags:
            picks = [request.known_tags[seed % len(request.known_tags)]]
            second = request.known_tags[(seed // 3) % len(request.known_tags)]
            if second not in picks:
                picks.append(second)
            tags = picks
        else:
            tags = [f"stub-tag-{digest[:4]}", f"stub-tag-{digest[4:8]}"]

        quote = request.content[:80].strip() or "empty content"
        evidence = [EvidenceItem(quote=quote[:500], start_offset=0, end_offset=len(quote[:500]))]

        # Hash-derived date: no clock access, so runs stay deterministic.
        deadline = None
        if seed % 4 == 0:
            deadline = Deadline(
                date=date(2030, 1, 1) + timedelta(days=seed % 365),
                reason=f"Stub deadline reason derived from content {digest[:12]}.",
                source=EvidenceItem(quote=quote[:500], start_offset=0, end_offset=len(quote[:500])),
            )

        result = EnrichmentResult(
            contract_version=CONTRACT_VERSION,
            summary=f"Deterministic stub summary for content {digest[:12]}.",
            key_takeaway=f"Stub takeaway derived from content {digest[:12]}.",
            tags=tags,
            deadline=deadline,
            evidence=evidence,
        )
        return EnrichmentOutcome(result=result, model_id=self.model_id)
