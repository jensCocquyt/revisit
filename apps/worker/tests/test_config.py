import pytest

from worker.config import database_url, enricher_name


def test_enricher_defaults_to_stub(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("ENRICHER", raising=False)
    assert enricher_name() == "stub"


def test_enricher_respects_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ENRICHER", "bedrock")
    assert enricher_name() == "bedrock"


def test_database_url_required(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="DATABASE_URL is required"):
        database_url()
