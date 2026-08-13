import pytest

from worker.config import (
    bedrock_model_id,
    database_url,
    enricher_name,
    fetch_allowed_content_types,
    fetch_allowed_hosts,
    fetch_max_bytes,
    fetch_max_redirects,
    fetch_timeout_seconds,
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


def test_fetch_defaults(monkeypatch: pytest.MonkeyPatch):
    for var in (
        "FETCH_MAX_REDIRECTS",
        "FETCH_MAX_BYTES",
        "FETCH_TIMEOUT_SECONDS",
        "FETCH_ALLOWED_CONTENT_TYPES",
        "FETCH_ALLOWED_HOSTS",
        "BEDROCK_MODEL_ID",
    ):
        monkeypatch.delenv(var, raising=False)
    assert fetch_max_redirects() == 5
    assert fetch_max_bytes() == 2_000_000
    assert fetch_timeout_seconds() == 15.0
    assert fetch_allowed_content_types() == frozenset(
        {"text/html", "application/xhtml+xml", "text/plain"}
    )
    assert fetch_allowed_hosts() == frozenset()
    assert bedrock_model_id() == ""


def test_fetch_respects_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("FETCH_MAX_REDIRECTS", "2")
    monkeypatch.setenv("FETCH_MAX_BYTES", "1000")
    monkeypatch.setenv("FETCH_TIMEOUT_SECONDS", "3.5")
    monkeypatch.setenv("FETCH_ALLOWED_CONTENT_TYPES", "text/html, Text/Plain")
    monkeypatch.setenv("FETCH_ALLOWED_HOSTS", "api, fixture.internal")
    monkeypatch.setenv("BEDROCK_MODEL_ID", "anthropic.claude-test-v1")
    assert fetch_max_redirects() == 2
    assert fetch_max_bytes() == 1000
    assert fetch_timeout_seconds() == 3.5
    assert fetch_allowed_content_types() == frozenset({"text/html", "text/plain"})
    assert fetch_allowed_hosts() == frozenset({"api", "fixture.internal"})
    assert bedrock_model_id() == "anthropic.claude-test-v1"


def test_worker_id_is_host_and_pid():
    first = worker_id()
    assert first == worker_id()
    host, _, pid = first.rpartition("-")
    assert host
    assert pid.isdigit()
