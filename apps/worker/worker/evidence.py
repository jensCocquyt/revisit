"""Evidence verification before persistence.

Every persisted quote must slice the stored page text exactly: exact offsets
are kept, a verbatim quote at wrong offsets is repaired to its first
occurrence, and a quote absent from the text is dropped, never guessed. The
same rule covers a deadline's source — but an unresolvable source drops the
whole deadline, since that date may later notify the user.
"""

from dataclasses import dataclass

from worker.contract import EnrichmentResult, EvidenceItem


@dataclass(frozen=True)
class ResolvedResult:
    result: EnrichmentResult
    evidence_dropped: int
    deadline_dropped: bool


def _resolve_item(item: EvidenceItem, text: str) -> EvidenceItem | None:
    if text[item.start_offset : item.end_offset] == item.quote:
        return item
    index = text.find(item.quote)
    if index >= 0:
        return item.model_copy(
            update={"start_offset": index, "end_offset": index + len(item.quote)}
        )
    return None


def resolve_evidence(result: EnrichmentResult, text: str) -> ResolvedResult:
    """Return the result with only resolvable evidence and a supported deadline."""
    kept = []
    changed = False
    for item in result.evidence:
        resolved = _resolve_item(item, text)
        if resolved is None:
            changed = True
        else:
            changed = changed or resolved is not item
            kept.append(resolved)
    dropped = len(result.evidence) - len(kept)

    deadline = result.deadline
    deadline_dropped = False
    if deadline is not None:
        source = _resolve_item(deadline.source, text)
        if source is None:
            deadline = None
            deadline_dropped = True
            changed = True
        elif source is not deadline.source:
            deadline = deadline.model_copy(update={"source": source})
            changed = True

    if not changed:
        return ResolvedResult(result, 0, False)
    updated = result.model_copy(update={"evidence": kept, "deadline": deadline})
    return ResolvedResult(updated, dropped, deadline_dropped)
