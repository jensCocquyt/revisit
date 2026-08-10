"""Shared fixtures. Integration tests use the `db` fixture and need DATABASE_URL
pointing at a migrated PostgreSQL (docker compose up -d postgres migrate); they
fail loudly when it is unset so a missing database never looks like a green run.
"""

import os
import uuid

import psycopg
import pytest


def _integration_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.fail(
            "DATABASE_URL must be set for integration tests. "
            "Start the database with `docker compose up -d postgres migrate` "
            "and export DATABASE_URL (see .env.example)."
        )
    return url


@pytest.fixture(scope="session")
def _neutralized_queue():
    """Claiming is global, so residue jobs (e.g. from API integration tests on the
    shared local database) would make claim assertions flaky. Complete any job
    still eligible once per session; tests then own the whole queue.
    """
    with psycopg.connect(_integration_database_url(), autocommit=True) as conn:
        conn.execute(
            """
            UPDATE enrichment_jobs
            SET status = 'completed', completed_at = now(), updated_at = now()
            WHERE (status = 'pending' AND available_at <= now())
               OR (status = 'processing' AND locked_until <= now())
            """
        )


@pytest.fixture
def db(_neutralized_queue):
    conn = psycopg.connect(_integration_database_url(), autocommit=True)
    yield conn
    conn.close()


@pytest.fixture
def db2(_neutralized_queue):
    """Second session for exclusivity tests (SKIP LOCKED needs two backends)."""
    conn = psycopg.connect(_integration_database_url(), autocommit=True)
    yield conn
    conn.close()


@pytest.fixture
def make_link(db: psycopg.Connection):
    """Insert a link and one enrichment job; rows are deleted after the test."""
    created: list[str] = []

    def _make(
        *,
        note: str | None = None,
        goal: str | None = None,
        available_in: float = 0.0,
        status: str = "pending",
        attempts: int = 0,
        locked_for: float | None = None,
        locked_by: str | None = None,
    ) -> tuple[str, str, str]:
        url = f"https://worker-tests.example/{uuid.uuid4()}"
        row = db.execute(
            "INSERT INTO links (url, normalized_url, note, goal) VALUES (%s, %s, %s, %s)"
            " RETURNING id",
            (url, url, note, goal),
        ).fetchone()
        assert row is not None
        link_id = str(row[0])
        row = db.execute(
            """
            INSERT INTO enrichment_jobs (link_id, status, attempts, available_at,
                                         locked_until, locked_by)
            VALUES (%s, %s, %s, now() + make_interval(secs => %s),
                    now() + make_interval(secs => %s), %s)
            RETURNING id
            """,
            (link_id, status, attempts, available_in, locked_for, locked_by),
        ).fetchone()
        assert row is not None
        created.append(link_id)
        return link_id, str(row[0]), url

    yield _make

    for link_id in created:
        db.execute("DELETE FROM enrichments WHERE link_id = %s", (link_id,))
        db.execute("DELETE FROM enrichment_jobs WHERE link_id = %s", (link_id,))
        db.execute("DELETE FROM links WHERE id = %s", (link_id,))
