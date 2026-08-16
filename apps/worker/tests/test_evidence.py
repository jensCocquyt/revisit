"""Evidence resolution: exact slice kept, verbatim match repaired, rest dropped.
A deadline whose source does not resolve loses the whole deadline."""

from datetime import date

from worker.contract import CONTRACT_VERSION, Deadline, EnrichmentResult, EvidenceItem
from worker.evidence import resolve_evidence

TEXT = "Replication copies data from a primary database to one or more replicas."


def result_with(evidence: list[EvidenceItem], deadline: Deadline | None = None) -> EnrichmentResult:
    return EnrichmentResult(
        contract_version=CONTRACT_VERSION,
        summary="s",
        key_takeaway="k",
        tags=["t"],
        deadline=deadline,
        evidence=evidence,
    )


def deadline_with(source: EvidenceItem) -> Deadline:
    return Deadline(date=date(2027, 5, 31), reason="r", source=source)


def test_exact_offsets_are_kept():
    item = EvidenceItem(quote="Replication copies data", start_offset=0, end_offset=23)
    resolved = resolve_evidence(result_with([item]), TEXT)
    assert resolved.evidence_dropped == 0
    assert resolved.result.evidence == [item]


def test_wrong_offsets_are_repaired_to_verbatim_match():
    item = EvidenceItem(quote="primary database", start_offset=3, end_offset=19)
    resolved = resolve_evidence(result_with([item]), TEXT)
    assert resolved.evidence_dropped == 0
    (kept,) = resolved.result.evidence
    assert TEXT[kept.start_offset : kept.end_offset] == "primary database"


def test_unresolvable_quote_is_dropped_and_counted():
    good = EvidenceItem(quote="one or more replicas", start_offset=0, end_offset=20)
    bad = EvidenceItem(quote="text that is not present", start_offset=0, end_offset=24)
    resolved = resolve_evidence(result_with([good, bad]), TEXT)
    assert resolved.evidence_dropped == 1
    (kept,) = resolved.result.evidence
    assert kept.quote == "one or more replicas"
    assert TEXT[kept.start_offset : kept.end_offset] == kept.quote


def test_offsets_past_end_of_text_repair_or_drop():
    item = EvidenceItem(quote="replicas.", start_offset=9_000, end_offset=9_009)
    resolved = resolve_evidence(result_with([item]), TEXT)
    assert resolved.evidence_dropped == 0
    (kept,) = resolved.result.evidence
    assert TEXT[kept.start_offset : kept.end_offset] == "replicas."


def test_empty_evidence_passes_through():
    result = result_with([])
    resolved = resolve_evidence(result, TEXT)
    assert resolved.evidence_dropped == 0
    assert resolved.result is result


def test_deadline_source_offsets_are_repaired():
    source = EvidenceItem(quote="primary database", start_offset=0, end_offset=16)
    resolved = resolve_evidence(result_with([], deadline_with(source)), TEXT)
    assert not resolved.deadline_dropped
    kept = resolved.result.deadline.source
    assert TEXT[kept.start_offset : kept.end_offset] == "primary database"


def test_unresolvable_deadline_source_drops_the_deadline():
    source = EvidenceItem(quote="a sentence not in the page", start_offset=0, end_offset=26)
    resolved = resolve_evidence(result_with([], deadline_with(source)), TEXT)
    assert resolved.deadline_dropped
    assert resolved.result.deadline is None
    assert resolved.evidence_dropped == 0


def test_resolvable_deadline_survives_untouched():
    source = EvidenceItem(quote="Replication copies data", start_offset=0, end_offset=23)
    result = result_with([], deadline_with(source))
    resolved = resolve_evidence(result, TEXT)
    assert not resolved.deadline_dropped
    assert resolved.result is result
