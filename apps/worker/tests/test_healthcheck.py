import pytest

from worker.healthcheck import check


class FakeCursor:
    def execute(self, sql):
        assert sql == "SELECT 1"

    def fetchone(self):
        return (1,)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeConnection:
    def cursor(self):
        return FakeCursor()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def fake_connect_ok(url, connect_timeout=None):
    return FakeConnection()


def fake_connect_down(url, connect_timeout=None):
    raise ConnectionError("connection refused")


@pytest.fixture(autouse=True)
def database_url_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://test:test@localhost:5432/test")


def test_healthy_database_exits_zero():
    assert check(connect=fake_connect_ok) == 0


def test_unreachable_database_exits_nonzero():
    assert check(connect=fake_connect_down) == 1


def test_missing_database_url_exits_nonzero(monkeypatch):
    monkeypatch.delenv("DATABASE_URL")
    assert check(connect=fake_connect_ok) == 1
