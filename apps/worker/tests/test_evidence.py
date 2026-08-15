"""Evidence resolution: exact slice kept, verbatim match repaired, rest dropped."""

from worker.contract import CONTRACT_VERSION, EvidenceItem, NonRevisitResult
from worker.evidence import resolve_evidence

TEXT = "Replication copies data from a primary database to one or more replicas."


def result_with(evidence: list[EvidenceItem]) -> NonRevisitResult:
    return NonRevisitResult(
        contract_version=CONTRACT_VERSION,
        summary="s",
        key_takeaway="k",
        topics=["t"],
        suggested_group="g",
        save_intent="reference",
        evidence=evidence,
        recommended_action="none",
    )


def test_exact_offsets_are_kept():
    item = EvidenceItem(quote="Replication copies data", start_offset=0, end_offset=23)
    resolved, dropped = resolve_evidence(result_with([item]), TEXT)
    assert dropped == 0
    assert resolved.evidence == [item]


def test_wrong_offsets_are_repaired_to_verbatim_match():
    item = EvidenceItem(quote="primary database", start_offset=3, end_offset=19)
    resolved, dropped = resolve_evidence(result_with([item]), TEXT)
    assert dropped == 0
    (kept,) = resolved.evidence
    assert TEXT[kept.start_offset : kept.end_offset] == "primary database"


def test_unresolvable_quote_is_dropped_and_counted():
    good = EvidenceItem(quote="one or more replicas", start_offset=0, end_offset=20)
    bad = EvidenceItem(quote="text that is not present", start_offset=0, end_offset=24)
    resolved, dropped = resolve_evidence(result_with([good, bad]), TEXT)
    assert dropped == 1
    (kept,) = resolved.evidence
    assert kept.quote == "one or more replicas"
    assert TEXT[kept.start_offset : kept.end_offset] == kept.quote


def test_offsets_past_end_of_text_repair_or_drop():
    item = EvidenceItem(quote="replicas.", start_offset=9_000, end_offset=9_009)
    resolved, dropped = resolve_evidence(result_with([item]), TEXT)
    assert dropped == 0
    (kept,) = resolved.evidence
    assert TEXT[kept.start_offset : kept.end_offset] == "replicas."


def test_empty_evidence_passes_through():
    result = result_with([])
    resolved, dropped = resolve_evidence(result, TEXT)
    assert dropped == 0
    assert resolved is result
