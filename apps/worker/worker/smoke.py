"""In-container smoke check: the stub enricher must produce a contract-valid result.

Run with: python -m worker.smoke
Used by the CI stack job; exits non-zero on any contract violation.
"""

import sys

from worker.contract import validation_errors
from worker.enricher import EnrichmentInput, get_enricher


def main() -> int:
    enricher = get_enricher("stub")
    outcome = enricher.enrich(EnrichmentInput(content="smoke check content"))
    errors = validation_errors(outcome.result)
    if errors:
        print(f"stub smoke FAILED: {errors}")
        return 1
    print(f"stub smoke ok: {outcome.result.recommended_action}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
