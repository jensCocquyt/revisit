import pytest

from worker.contract import is_valid
from worker.enricher import Enricher, EnrichmentInput, get_enricher
from worker.stub import StubEnricher

SAMPLE_INPUTS = [
    EnrichmentInput(content="A long article about database replication strategies."),
    EnrichmentInput(content="Framework documentation.", note="for the migration", goal="platform"),
    EnrichmentInput(content=""),
    EnrichmentInput(content="x" * 10_000, note="huge page"),
    EnrichmentInput(content="Release announcement for Q4.", goal="interview preparation"),
]


@pytest.mark.parametrize("request_", SAMPLE_INPUTS, ids=range(len(SAMPLE_INPUTS)))
def test_stub_output_is_contract_valid(request_: EnrichmentInput):
    outcome = StubEnricher().enrich(request_)
    assert is_valid(outcome.result)


@pytest.mark.parametrize("request_", SAMPLE_INPUTS, ids=range(len(SAMPLE_INPUTS)))
def test_stub_is_deterministic(request_: EnrichmentInput):
    first = StubEnricher().enrich(request_)
    second = StubEnricher().enrich(request_)
    assert first.result == second.result
    assert first.model_id == second.model_id


def test_different_inputs_differ():
    a = StubEnricher().enrich(EnrichmentInput(content="content a"))
    b = StubEnricher().enrich(EnrichmentInput(content="content b"))
    assert a.result != b.result


def test_note_and_goal_affect_result():
    plain = StubEnricher().enrich(EnrichmentInput(content="same content"))
    with_note = StubEnricher().enrich(EnrichmentInput(content="same content", note="a note"))
    assert plain.result != with_note.result


def test_stub_is_default_enricher():
    assert isinstance(get_enricher("stub"), StubEnricher)


def test_stub_satisfies_the_seam():
    assert isinstance(StubEnricher(), Enricher)


def test_stub_declares_prompt_version():
    assert StubEnricher.prompt_version == "stub-v1"


def test_bedrock_is_selectable(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("BEDROCK_MODEL_ID", "anthropic.claude-test-v1")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    from worker.bedrock import BedrockEnricher

    assert isinstance(get_enricher("bedrock"), BedrockEnricher)


def test_unknown_enricher_rejected():
    with pytest.raises(ValueError, match="Unknown enricher"):
        get_enricher("gpt")
