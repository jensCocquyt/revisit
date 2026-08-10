"""Integration tests for job claiming and processing against real PostgreSQL.

Requires DATABASE_URL (see conftest). Failures are forced by injecting a
raising Enricher fake; the ENRICHER env selection and stub default are
untouched.
"""

import hashlib

import psycopg
from psycopg.rows import dict_row

from worker.contract import validation_errors
from worker.enricher import Enricher, EnrichmentInput, EnrichmentOutcome
from worker.jobs import PROMPT_VERSION, backoff_seconds, claim_one, process_one
from worker.stub import StubEnricher

WORKER = "test-worker-a"
OTHER = "test-worker-b"


class ExplodingEnricher(Enricher):
    def enrich(self, request: EnrichmentInput) -> EnrichmentOutcome:
        raise TimeoutError("upstream timed out")


class TransactionSpy(Enricher):
    """Records the connection's transaction status while enrichment runs."""

    def __init__(self, conn: psycopg.Connection):
        self.conn = conn
        self.status: psycopg.pq.TransactionStatus | None = None

    def enrich(self, request: EnrichmentInput) -> EnrichmentOutcome:
        self.status = self.conn.info.transaction_status
        return StubEnricher().enrich(request)


def claim(db: psycopg.Connection, worker: str = WORKER, lease: float = 60.0):
    return claim_one(db, lease_seconds=lease, worker_id=worker)


def process(db, job, enricher, worker: str = WORKER, max_attempts: int = 3) -> bool:
    return process_one(db, job, enricher, max_attempts=max_attempts, worker_id=worker)


def fetch_job(db: psycopg.Connection, job_id: str) -> dict:
    with db.cursor(row_factory=dict_row) as cur:
        row = cur.execute(
            """
            SELECT *, available_at > now() AS scheduled_ahead,
                   locked_until > now() AS lease_active,
                   extract(epoch FROM available_at - now()) AS delay_seconds
            FROM enrichment_jobs WHERE id = %s
            """,
            (job_id,),
        ).fetchone()
    assert row is not None
    return row


def link_status(db: psycopg.Connection, link_id: str) -> str:
    row = db.execute("SELECT status FROM links WHERE id = %s", (link_id,)).fetchone()
    assert row is not None
    return row[0]


def enrichment_rows(db: psycopg.Connection, link_id: str) -> list[dict]:
    with db.cursor(row_factory=dict_row) as cur:
        return cur.execute("SELECT * FROM enrichments WHERE link_id = %s", (link_id,)).fetchall()


def make_available_now(db: psycopg.Connection, job_id: str) -> None:
    db.execute("UPDATE enrichment_jobs SET available_at = now() WHERE id = %s", (job_id,))


def expire_lease(db: psycopg.Connection, job_id: str) -> None:
    db.execute(
        "UPDATE enrichment_jobs SET locked_until = now() - interval '1 second' WHERE id = %s",
        (job_id,),
    )


class TestClaiming:
    def test_eligible_pending_job_is_claimed(self, db, make_link):
        link_id, job_id, _ = make_link()
        job = claim(db)
        assert job is not None
        assert (job.id, job.link_id, job.attempts) == (job_id, link_id, 0)
        row = fetch_job(db, job_id)
        assert row["status"] == "processing"
        assert row["lease_active"] is True
        assert row["locked_by"] == WORKER

    def test_future_job_is_not_claimed(self, db, make_link):
        _, job_id, _ = make_link(available_in=3600)
        assert claim(db) is None
        assert fetch_job(db, job_id)["status"] == "pending"

    def test_empty_queue_claims_nothing(self, db):
        assert claim(db) is None

    def test_uncommitted_claim_blocks_other_claimer(self, db, db2, make_link):
        _, job_id, _ = make_link()
        with db2.transaction():
            first = claim(db2, worker=OTHER)
            assert first is not None and first.id == job_id
            # db2's claim is uncommitted: the row is locked, so SKIP LOCKED
            # makes the second claimer pass over it instead of blocking.
            assert claim(db) is None
        assert fetch_job(db, job_id)["locked_by"] == OTHER

    def test_expired_lease_is_reclaimed(self, db, make_link):
        _, job_id, _ = make_link(status="processing", locked_for=-30, locked_by=OTHER)
        job = claim(db)
        assert job is not None and job.id == job_id
        row = fetch_job(db, job_id)
        assert row["locked_by"] == WORKER
        assert row["lease_active"] is True

    def test_valid_lease_is_not_reclaimed(self, db, make_link):
        _, job_id, _ = make_link(status="processing", locked_for=3600, locked_by=OTHER)
        assert claim(db) is None
        assert fetch_job(db, job_id)["locked_by"] == OTHER


class TestSuccess:
    def test_write_back_stores_contract_valid_result(self, db, make_link):
        link_id, job_id, url = make_link(note="why", goal="prep")
        job = claim(db)
        assert process(db, job, StubEnricher()) is True

        rows = enrichment_rows(db, link_id)
        assert len(rows) == 1
        assert validation_errors(rows[0]["result"]) == []
        assert rows[0]["content_hash"] == hashlib.sha256(url.encode()).hexdigest()
        assert rows[0]["content_version_id"] is None
        assert rows[0]["prompt_version"] == PROMPT_VERSION
        assert rows[0]["model_id"] == "stub"

        row = fetch_job(db, job_id)
        assert row["status"] == "completed"
        assert row["completed_at"] is not None
        assert row["locked_until"] is None and row["locked_by"] is None
        assert link_status(db, link_id) == "enriched"

    def test_enrichment_runs_without_open_transaction(self, db, make_link):
        make_link()
        spy = TransactionSpy(db)
        assert process(db, claim(db), spy) is True
        assert spy.status == psycopg.pq.TransactionStatus.IDLE

    def test_repeated_processing_yields_exactly_one_row(self, db, make_link):
        link_id, job_id, _ = make_link()
        job = claim(db)
        assert process(db, job, StubEnricher()) is True
        # Replay the same claim, as after a crash between enrich and write-back.
        assert process(db, job, StubEnricher()) is False
        assert len(enrichment_rows(db, link_id)) == 1
        assert fetch_job(db, job_id)["status"] == "completed"
        assert link_status(db, link_id) == "enriched"

    def test_stale_claimant_skips_write_back(self, db, make_link):
        link_id, job_id, _ = make_link()
        stale = claim(db)
        expire_lease(db, job_id)
        fresh = claim(db, worker=OTHER)
        assert fresh is not None and fresh.id == job_id

        # The stale claimant finishes late: its insert is idempotent, but the
        # current claimant owns the statuses.
        assert process(db, stale, StubEnricher()) is False
        row = fetch_job(db, job_id)
        assert row["status"] == "processing"
        assert row["locked_by"] == OTHER

        assert process(db, fresh, StubEnricher(), worker=OTHER) is True
        assert len(enrichment_rows(db, link_id)) == 1
        assert link_status(db, link_id) == "enriched"


class TestFailure:
    def test_transient_failure_reschedules_with_backoff(self, db, make_link):
        link_id, job_id, _ = make_link()
        assert process(db, claim(db), ExplodingEnricher()) is False

        row = fetch_job(db, job_id)
        assert row["status"] == "pending"
        assert row["attempts"] == 1
        assert row["last_error"].startswith("enrich_error: TimeoutError")
        assert row["scheduled_ahead"] is True
        assert 3 < row["delay_seconds"] <= 5
        assert row["locked_until"] is None and row["locked_by"] is None
        assert link_status(db, link_id) == "pending"

        # Second failure waits longer than the first.
        make_available_now(db, job_id)
        assert process(db, claim(db), ExplodingEnricher()) is False
        row = fetch_job(db, job_id)
        assert row["attempts"] == 2
        assert 8 < row["delay_seconds"] <= 10

    def test_backoff_is_non_decreasing_and_capped(self):
        delays = [backoff_seconds(attempts) for attempts in range(8)]
        assert delays[:4] == [5, 10, 20, 40]
        assert all(later >= earlier for earlier, later in zip(delays[:-1], delays[1:], strict=True))
        assert max(delays) == 60

    def test_third_failure_is_terminal(self, db, make_link):
        link_id, job_id, _ = make_link()
        for _ in range(3):
            make_available_now(db, job_id)
            job = claim(db)
            assert job is not None
            assert process(db, job, ExplodingEnricher()) is False

        row = fetch_job(db, job_id)
        assert row["status"] == "failed"
        assert row["attempts"] == 3
        assert row["last_error"].startswith("enrich_error: TimeoutError")
        assert row["completed_at"] is None
        assert link_status(db, link_id) == "failed"
        assert enrichment_rows(db, link_id) == []
