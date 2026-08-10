import pytest

from worker.config import (
    database_url,
    enricher_name,
    lease_seconds,
    max_attempts,
    poll_seconds,
    worker_id,
)


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


def test_processing_defaults(monkeypatch: pytest.MonkeyPatch):
    for var in ("WORKER_POLL_SECONDS", "WORKER_LEASE_SECONDS", "WORKER_MAX_ATTEMPTS"):
        monkeypatch.delenv(var, raising=False)
    assert poll_seconds() == 2.0
    assert lease_seconds() == 60.0
    assert max_attempts() == 3


def test_processing_respects_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("WORKER_POLL_SECONDS", "0.1")
    monkeypatch.setenv("WORKER_LEASE_SECONDS", "5")
    monkeypatch.setenv("WORKER_MAX_ATTEMPTS", "1")
    assert poll_seconds() == 0.1
    assert lease_seconds() == 5.0
    assert max_attempts() == 1


def test_worker_id_is_host_and_pid():
    first = worker_id()
    assert first == worker_id()
    host, _, pid = first.rpartition("-")
    assert host
    assert pid.isdigit()
