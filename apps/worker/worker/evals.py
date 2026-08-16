"""Offline evaluation of enrichment quality over the labelled fixture set.

`python -m worker.evals` runs every case in `evals/fixtures/` through the
production seam — extraction, the configured enricher, contract validation,
evidence resolution — and prints a markdown report. Gated measures (schema
validity, evidence resolution) must be 100% under `--gate`; the quality
measures (deadline recall/specificity, date accuracy, tag precision/recall)
are reported only, all higher-is-better. The vocabulary passed to the
enricher is the sorted union of all expected tags, so closed-world
assignment is exercised and stub runs stay deterministic.
"""

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

from worker import config
from worker.enrichers import Enricher, EnrichmentInput, get_enricher
from worker.evidence import resolve_evidence
from worker.extract import extract_content

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "evals" / "fixtures"
LABEL_KEYS = {"expected_tags", "expected_deadline"}


@dataclass(frozen=True)
class EvalCase:
    name: str
    html: str
    expected_tags: tuple[str, ...]
    expected_deadline: str | None
    note: str | None = None
    goal: str | None = None


@dataclass(frozen=True)
class CaseResult:
    case: EvalCase
    error: str | None = None  # non-None marks the case schema-invalid
    tags: tuple[str, ...] = ()
    deadline_date: str | None = None
    evidence_total: int = 0
    evidence_resolved: int = 0

    @property
    def valid(self) -> bool:
        return self.error is None


@dataclass(frozen=True)
class Measure:
    label: str
    numerator: int
    denominator: int
    gated: bool = False

    @property
    def rate(self) -> float | None:
        return self.numerator / self.denominator if self.denominator else None

    def format(self) -> str:
        if self.rate is None:
            return "n/a"
        return f"{100 * self.rate:.1f}% ({self.numerator}/{self.denominator})"


def load_cases(fixtures_dir: Path) -> list[EvalCase]:
    cases = []
    for label_path in sorted(fixtures_dir.glob("*.json")):
        html_path = label_path.with_suffix(".html")
        if not html_path.exists():
            raise FileNotFoundError(f"label {label_path.name} has no matching .html snapshot")
        labels = json.loads(label_path.read_text(encoding="utf-8"))
        missing = LABEL_KEYS - labels.keys()
        if missing:
            raise ValueError(f"{label_path.name} is missing label keys: {sorted(missing)}")
        cases.append(
            EvalCase(
                name=label_path.stem,
                html=html_path.read_text(encoding="utf-8"),
                expected_tags=tuple(labels["expected_tags"]),
                expected_deadline=labels["expected_deadline"],
                note=labels.get("note"),
                goal=labels.get("goal"),
            )
        )
    if not cases:
        raise FileNotFoundError(f"no eval cases found in {fixtures_dir}")
    return cases


def vocabulary(cases: list[EvalCase]) -> tuple[str, ...]:
    return tuple(sorted({tag for case in cases for tag in case.expected_tags}))


def run_case(case: EvalCase, enricher: Enricher, known_tags: tuple[str, ...]) -> CaseResult:
    # Snapshot content is untrusted data: it flows only through the production
    # extraction path into the enricher, exactly as in job processing.
    try:
        content = extract_content(case.html, "text/html")
        outcome = enricher.enrich(
            EnrichmentInput(
                content=content.text, note=case.note, goal=case.goal, known_tags=known_tags
            )
        )
    except Exception as exc:  # noqa: BLE001 - one bad case must not abort the run
        return CaseResult(case=case, error=f"{type(exc).__name__}: {exc}"[:200])
    raw = outcome.result
    resolved = resolve_evidence(raw, content.text)
    total = len(raw.evidence) + (1 if raw.deadline else 0)
    unresolved = resolved.evidence_dropped + (1 if resolved.deadline_dropped else 0)
    deadline = resolved.result.deadline
    return CaseResult(
        case=case,
        tags=tuple(resolved.result.tags),
        deadline_date=deadline.date.isoformat() if deadline else None,
        evidence_total=total,
        evidence_resolved=total - unresolved,
    )


def run_evals(cases: list[EvalCase], enricher: Enricher) -> list[CaseResult]:
    known_tags = vocabulary(cases)
    return [run_case(case, enricher, known_tags) for case in cases]


def measures(results: list[CaseResult]) -> list[Measure]:
    valid = [r for r in results if r.valid]
    no_deadline_expected = [r for r in valid if r.case.expected_deadline is None]
    deadline_expected = [r for r in valid if r.case.expected_deadline is not None]
    produced_on_expected = [r for r in deadline_expected if r.deadline_date is not None]
    tag_hits = sum(len(set(r.tags) & set(r.case.expected_tags)) for r in valid)
    return [
        Measure("Schema validity", len(valid), len(results), gated=True),
        Measure(
            "Evidence resolution rate",
            sum(r.evidence_resolved for r in valid),
            sum(r.evidence_total for r in valid),
            gated=True,
        ),
        Measure("Deadline recall", len(produced_on_expected), len(deadline_expected)),
        Measure(
            "Deadline specificity",
            sum(r.deadline_date is None for r in no_deadline_expected),
            len(no_deadline_expected),
        ),
        Measure(
            "Date accuracy",
            sum(r.deadline_date == r.case.expected_deadline for r in produced_on_expected),
            len(produced_on_expected),
        ),
        Measure("Tag precision", tag_hits, sum(len(r.tags) for r in valid)),
        Measure("Tag recall", tag_hits, sum(len(r.case.expected_tags) for r in valid)),
    ]


def gate_failures(all_measures: list[Measure]) -> list[str]:
    """Gated measures below 100%. Reads computed rates, never parses report text."""
    return [
        f"{m.label} is {m.format()}, must be 100%"
        for m in all_measures
        if m.gated and (m.rate is None or m.rate < 1.0)
    ]


def render_report(
    results: list[CaseResult], all_measures: list[Measure], enricher_name: str
) -> str:
    lines = [
        "# Enrichment eval report",
        "",
        f"Enricher: `{enricher_name}` | Cases: {len(results)}",
        "",
        "| Measure | Value | Gated |",
        "| --- | --- | --- |",
    ]
    for m in all_measures:
        lines.append(f"| {m.label} | {m.format()} | {'yes' if m.gated else 'no'} |")
    lines += [
        "",
        "## Cases",
        "",
        "| Case | Schema | Tags (got / expected) | Deadline (got / expected) | Evidence resolved |",
        "| --- | --- | --- | --- | --- |",
    ]
    for r in results:
        if r.valid:
            lines.append(
                f"| {r.case.name} | ok | {', '.join(r.tags)} / {', '.join(r.case.expected_tags)}"
                f" | {r.deadline_date or '-'} / {r.case.expected_deadline or '-'}"
                f" | {r.evidence_resolved}/{r.evidence_total} |"
            )
        else:
            lines.append(
                f"| {r.case.name} | INVALID: {r.error} | - / {', '.join(r.case.expected_tags)}"
                f" | - / {r.case.expected_deadline or '-'} | - |"
            )
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m worker.evals", description="Run the labelled enrichment eval set."
    )
    parser.add_argument(
        "--gate",
        action="store_true",
        help="exit non-zero unless schema validity and evidence resolution are 100%%",
    )
    parser.add_argument(
        "--fixtures", type=Path, default=FIXTURES_DIR, help="fixtures directory override"
    )
    args = parser.parse_args(argv)

    enricher_name = config.enricher_name()
    results = run_evals(load_cases(args.fixtures), get_enricher(enricher_name))
    all_measures = measures(results)
    print(render_report(results, all_measures, enricher_name), end="")

    if not args.gate:
        return 0
    failures = gate_failures(all_measures)
    for failure in failures:
        print(f"GATE FAILED: {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
