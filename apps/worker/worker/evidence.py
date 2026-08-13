"""Evidence verification: every persisted item must resolve to stored text.

An item resolves only if its quote appears verbatim in the extracted text.
Offsets are trusted when they already point at the quote, otherwise rewritten
to the first verbatim occurrence — deterministic exact matching, never a
guess. Items whose quote is not in the text are dropped.
"""

from worker.contract import NonRevisitResult, RevisitResult


def resolve_evidence(
    result: NonRevisitResult | RevisitResult, text: str
) -> tuple[NonRevisitResult | RevisitResult, int]:
    """Return the result with only resolvable evidence, plus the drop count."""
    kept = []
    changed = False
    for item in result.evidence:
        if text[item.start_offset : item.end_offset] == item.quote:
            kept.append(item)
            continue
        changed = True
        index = text.find(item.quote)
        if index >= 0:
            kept.append(
                item.model_copy(
                    update={"start_offset": index, "end_offset": index + len(item.quote)}
                )
            )
    dropped = len(result.evidence) - len(kept)
    if not changed:
        return result, 0
    return result.model_copy(update={"evidence": kept}), dropped
