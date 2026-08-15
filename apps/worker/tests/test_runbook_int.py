"""The runbook's requeue SQL, extracted verbatim from the doc and proven against
real PostgreSQL, so the documented recovery procedure cannot rot.
"""

import re
from pathlib import Path

import pytest
from psycopg.rows import dict_row

from worker.enrichers.stub import StubEnricher
from worker.errors import FetchTransientError
from worker.jobs import claim_one, process_one
from worker.safe_fetch import FetchedPage

RUNBOOK = Path(__file__).resolve().parents[3] / "docs" / "runbook.md"
MARKER = "-- runbook:requeue"
WORKER = "runbook-test-worker"

PAGE_TEXT = "Requeued pages are fetched again and enriched like any other saved page."


def requeue_sql() -> str:
    text = RUNBOOK.read_text(encoding="utf-8")
    match = re.search(rf"```sql\s*\n({re.escape(MARKER)}\n.*?)```", text, re.DOTALL)
    if match is None:
        pytest.fail(f"docs/runbook.md has no fenced sql block starting with {MARKER!r}")
    return match.group(1)


def failing_fetcher(url: str) -> FetchedPage:
    raise FetchTransientError("fetch_timeout", f"budget exceeded for {url}")


def ok_fetcher(url: str) -> FetchedPage:
    return FetchedPage(url=url, body=PAGE_TEXT, content_type="text/plain")


def job_row(db, job_id: str) -> dict:
    with db.cursor(row_factory=dict_row) as cur:
        row = cur.execute(
            "SELECT *, available_at <= now() AS available_now FROM enrichment_jobs WHERE id = %s",
            (job_id,),
        ).fetchone()
    assert row is not None
    return row


def link_status(db, link_id: str) -> str:
    row = db.execute("SELECT status FROM links WHERE id = %s", (link_id,)).fetchone()
    assert row is not None
    return row[0]


def test_requeue_sql_block_is_present_and_extractable():
    sql = requeue_sql()
    assert sql.startswith(MARKER)
    assert "UPDATE enrichment_jobs" in sql


def test_documented_requeue_sql_recovers_a_failed_job(db, make_link):
    link_id, job_id, _ = make_link()
    # The documented statement requeues every failed job; complete unrelated
    # failed residue on the shared database so the run stays scoped to ours.
    db.execute(
        "UPDATE enrichment_jobs SET status = 'completed', updated_at = now()"
        " WHERE status = 'failed'"
    )

    for _ in range(3):
        db.execute("UPDATE enrichment_jobs SET available_at = now() WHERE id = %s", (job_id,))
        job = claim_one(db, lease_seconds=60.0, worker_id=WORKER)
        assert job is not None and job.id == job_id
        assert (
            process_one(
                db, job, StubEnricher(), max_attempts=3, worker_id=WORKER, fetcher=failing_fetcher
            )
            is False
        )
    row = job_row(db, job_id)
    assert row["status"] == "failed"
    assert row["attempts"] == 3
    assert link_status(db, link_id) == "failed"

    db.execute(requeue_sql())

    row = job_row(db, job_id)
    assert row["status"] == "pending"
    assert row["attempts"] == 0
    assert row["last_error"] is None
    assert row["locked_until"] is None and row["locked_by"] is None
    assert row["available_now"] is True
    assert link_status(db, link_id) == "pending"

    job = claim_one(db, lease_seconds=60.0, worker_id=WORKER)
    assert job is not None and job.id == job_id
    assert job.attempts == 0  # fresh retry budget
    assert (
        process_one(db, job, StubEnricher(), max_attempts=3, worker_id=WORKER, fetcher=ok_fetcher)
        is True
    )
    row = job_row(db, job_id)
    assert row["status"] == "completed"
    assert row["completed_at"] is not None
    assert link_status(db, link_id) == "enriched"
