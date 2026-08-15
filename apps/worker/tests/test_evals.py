"""Tests for the eval command over the labelled fixture set: no database, no network."""

from datetime import date

import worker.evals as evals
from worker.contract import Deadline
from worker.enrichers import Enricher, EnrichmentInput, EnrichmentOutcome
from worker.enrichers.stub import StubEnricher
from worker.evals import (
    FIXTURES_DIR,
    gate_failures,
    load_cases,
    main,
    measures,
    render_report,
    run_evals,
)


class ExplodeOnceEnricher(Enricher):
    """Raises on the first case only, so the rest of the run must still happen."""

    prompt_version = "explode-v1"

    def __init__(self) -> None:
        self.calls = 0

    def enrich(self, request: EnrichmentInput) -> EnrichmentOutcome:
        self.calls += 1
        if self.calls == 1:
            raise TimeoutError("model timed out")
        return StubEnricher().enrich(request)


class UnresolvableEvidenceEnricher(Enricher):
    prompt_version = "unresolvable-v1"

    def enrich(self, request: EnrichmentInput) -> EnrichmentOutcome:
        outcome = StubEnricher().enrich(request)
        bad = outcome.result.evidence[0].model_copy(update={"quote": "quote absent from page"})
        result = outcome.result.model_copy(update={"evidence": [bad], "deadline": None})
        return EnrichmentOutcome(result=result, model_id="unresolvable")


class AlwaysDeadlineEnricher(Enricher):
    """Asserts a resolvable deadline on every case — a false-deadline machine."""

    prompt_version = "deadline-v1"

    def enrich(self, request: EnrichmentInput) -> EnrichmentOutcome:
        outcome = StubEnricher().enrich(request)
        deadline = Deadline(
            date=date(2030, 6, 1), reason="fabricated", source=outcome.result.evidence[0]
        )
        result = outcome.result.model_copy(update={"deadline": deadline})
        return EnrichmentOutcome(result=result, model_id="deadline")


def stub_report() -> str:
    results = run_evals(load_cases(FIXTURES_DIR), StubEnricher())
    return render_report(results, measures(results), "stub")


def test_fixture_set_shape():
    cases = load_cases(FIXTURES_DIR)
    assert 10 <= len(cases) <= 15
    assert sum(c.expected_deadline is not None for c in cases) >= 2
    assert sum(c.expected_deadline is None for c in cases) >= 2


def test_stub_report_is_byte_identical():
    assert stub_report() == stub_report()


def test_gate_passes_on_stub_despite_imperfect_quality():
    results = run_evals(load_cases(FIXTURES_DIR), StubEnricher())
    all_measures = measures(results)
    quality = [m for m in all_measures if not m.gated]
    assert any(m.rate is not None and m.rate < 1.0 for m in quality)
    assert gate_failures(all_measures) == []


def test_raising_case_is_schema_invalid_without_aborting():
    cases = load_cases(FIXTURES_DIR)
    results = run_evals(cases, ExplodeOnceEnricher())
    assert len(results) == len(cases)
    invalid = [r for r in results if not r.valid]
    assert len(invalid) == 1
    assert "TimeoutError" in invalid[0].error
    failures = gate_failures(measures(results))
    assert any("Schema validity" in f for f in failures)


def test_unresolvable_evidence_fails_gate():
    results = run_evals(load_cases(FIXTURES_DIR), UnresolvableEvidenceEnricher())
    failures = gate_failures(measures(results))
    assert any("Evidence resolution rate" in f for f in failures)


def test_false_deadlines_are_counted():
    cases = load_cases(FIXTURES_DIR)
    results = run_evals(cases, AlwaysDeadlineEnricher())
    (false_deadline,) = [m for m in measures(results) if m.label == "False-deadline rate"]
    assert false_deadline.rate == 1.0
    # Resolvable deadlines never gate — fabrication is a quality signal, not a schema one.
    assert gate_failures(measures(results)) == []


def test_main_gate_exit_zero_on_stub(capsys):
    assert main(["--gate"]) == 0
    out = capsys.readouterr().out
    assert "# Enrichment eval report" in out
    assert "GATE FAILED" not in out


def test_main_gate_exit_nonzero_on_unresolvable_evidence(monkeypatch, capsys):
    monkeypatch.setattr(evals, "get_enricher", lambda name: UnresolvableEvidenceEnricher())
    assert main(["--gate"]) == 1
    assert "GATE FAILED: Evidence resolution rate" in capsys.readouterr().out
