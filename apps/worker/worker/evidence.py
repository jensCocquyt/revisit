"""Evidence verification before persistence.

Evidence is what makes the analysis trustworthy: each claim cites a quote at
an offset in the stored page text, so users can check the model is describing
the real page and not hallucinating. That only holds if every citation is
verified before it is stored.

Per item: exact offsets are kept; a verbatim quote at wrong offsets is
repaired to its first occurrence; a quote absent from the text is dropped,
never guessed. Every persisted item's slice of the stored text equals its
quote.
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
            kept.append(item)  # offsets already point at the quote
            continue
        changed = True
        index = text.find(item.quote)
        if index >= 0:
            # Quote exists, offsets are wrong (models miscount): repair to the
            # first verbatim occurrence.
            kept.append(
                item.model_copy(
                    update={"start_offset": index, "end_offset": index + len(item.quote)}
                )
            )
        # else: quote is not in the text — drop the item.
    dropped = len(result.evidence) - len(kept)
    if not changed:
        return result, 0
    return result.model_copy(update={"evidence": kept}), dropped
