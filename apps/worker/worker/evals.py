"""Offline evaluation of enrichment quality over the labelled fixture set.

`python -m worker.evals` runs every case in `evals/fixtures/` through the
production seam — extraction, the configured enricher, contract validation,
evidence resolution — and prints a markdown report of the five build-spec
measures. No database, no network with the stub. `--gate` exits non-zero
unless the two measures the stub can prove (schema validity and evidence
resolution) are both 100%; accuracy measures never gate.
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
LABEL_KEYS = {"expected_save_intent", "expected_recommended_action", "revisit_justified"}


@dataclass(frozen=True)
class EvalCase:
    name: str
    html: str
    expected_save_intent: str
    expected_recommended_action: str
    revisit_justified: bool
    note: str | None = None
    goal: str | None = None


@dataclass(frozen=True)
class CaseResult:
    case: EvalCase
    error: str | None = None  # non-None marks the case schema-invalid
    save_intent: str | None = None
    recommended_action: str | None = None
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
    gated: bool

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
                expected_save_intent=labels["expected_save_intent"],
                expected_recommended_action=labels["expected_recommended_action"],
                revisit_justified=labels["revisit_justified"],
                note=labels.get("note"),
                goal=labels.get("goal"),
            )
        )
    if not cases:
        raise FileNotFoundError(f"no eval cases found in {fixtures_dir}")
    return cases


def run_case(case: EvalCase, enricher: Enricher) -> CaseResult:
    # Snapshot content is untrusted data: it flows only through the production
    # extraction path into the enricher, exactly as in job processing.
    try:
        content = extract_content(case.html, "text/html")
        outcome = enricher.enrich(
            EnrichmentInput(content=content.text, note=case.note, goal=case.goal)
        )
    except Exception as exc:  # noqa: BLE001 - one bad case must not abort the run
        return CaseResult(case=case, error=f"{type(exc).__name__}: {exc}"[:200])
    result = outcome.result
    _, dropped = resolve_evidence(result, content.text)
    return CaseResult(
        case=case,
        save_intent=result.save_intent,
        recommended_action=result.recommended_action,
        evidence_total=len(result.evidence),
        evidence_resolved=len(result.evidence) - dropped,
    )


def run_evals(cases: list[EvalCase], enricher: Enricher) -> list[CaseResult]:
    return [run_case(case, enricher) for case in cases]


def measures(results: list[CaseResult]) -> list[Measure]:
    valid = [r for r in results if r.valid]
    not_justified = [r for r in valid if not r.case.revisit_justified]
    return [
        Measure("Schema validity", len(valid), len(results), gated=True),
        Measure(
            "Save-intent accuracy",
            sum(r.save_intent == r.case.expected_save_intent for r in valid),
            len(valid),
            gated=False,
        ),
        Measure(
            "Recommended-action accuracy",
            sum(r.recommended_action == r.case.expected_recommended_action for r in valid),
            len(valid),
            gated=False,
        ),
        Measure(
            "False-revisit rate",
            sum(r.recommended_action == "revisit" for r in not_justified),
            len(not_justified),
            gated=False,
        ),
        Measure(
            "Evidence resolution rate",
            sum(r.evidence_resolved for r in valid),
            sum(r.evidence_total for r in valid),
            gated=True,
        ),
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
        "| Case | Schema | Save intent (got / expected) | Action (got / expected)"
        " | Revisit justified | Evidence resolved |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for r in results:
        if r.valid:
            lines.append(
                f"| {r.case.name} | ok | {r.save_intent} / {r.case.expected_save_intent}"
                f" | {r.recommended_action} / {r.case.expected_recommended_action}"
                f" | {'yes' if r.case.revisit_justified else 'no'}"
                f" | {r.evidence_resolved}/{r.evidence_total} |"
            )
        else:
            lines.append(
                f"| {r.case.name} | INVALID: {r.error} | - / {r.case.expected_save_intent}"
                f" | - / {r.case.expected_recommended_action}"
                f" | {'yes' if r.case.revisit_justified else 'no'} | - |"
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
