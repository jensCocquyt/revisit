"""Integration tests for job claiming and pipeline processing against real PostgreSQL.

Requires DATABASE_URL (see conftest). Fully offline: pages come from an
injected fetcher (plain text so extraction is trivially deterministic), the
SSRF guard runs with a fake resolver, and enrichers are the stub or fakes.
"""

import hashlib

import psycopg
from psycopg.rows import dict_row

from worker.contract import validation_errors
from worker.enricher import Enricher, EnricherError, EnrichmentInput, EnrichmentOutcome
from worker.jobs import backoff_seconds, claim_one, process_one
from worker.safe_fetch import FetchedPage, FetchLimits, FetchTransientError, fetch_page
from worker.stub import StubEnricher

WORKER = "test-worker-a"
OTHER = "test-worker-b"

PAGE_TEXT = (
    "Replication copies data from a primary database to one or more replicas "
    "so that reads can scale out and failures can be survived."
)


def text_fetcher(text: str = PAGE_TEXT):
    def fetcher(url: str) -> FetchedPage:
        return FetchedPage(url=url, body=text, content_type="text/plain")

    return fetcher


def blocked_fetcher(url: str) -> FetchedPage:
    """The real guarded fetch, with DNS faked to a private address."""
    limits = FetchLimits(
        max_redirects=5,
        max_bytes=1_000_000,
        timeout_seconds=5.0,
        allowed_content_types=frozenset({"text/plain"}),
        allowed_hosts=frozenset(),
    )
    return fetch_page(url, limits=limits, resolver=lambda host: ["10.0.0.5"])


class ExplodingEnricher(Enricher):
    prompt_version = "test-v1"

    def enrich(self, request: EnrichmentInput) -> EnrichmentOutcome:
        raise TimeoutError("upstream timed out")


class InvalidOutputEnricher(Enricher):
    prompt_version = "test-v1"

    def enrich(self, request: EnrichmentInput) -> EnrichmentOutcome:
        raise EnricherError("invalid_model_output", "contract violation: summary too short")


class MetadataEnricher(Enricher):
    """Stub result, but reporting model metadata like a real backend."""

    prompt_version = "metadata-v1"

    def enrich(self, request: EnrichmentInput) -> EnrichmentOutcome:
        outcome = StubEnricher().enrich(request)
        return EnrichmentOutcome(
            result=outcome.result,
            model_id="fake-model",
            latency_ms=42,
            token_usage={"input_tokens": 10, "output_tokens": 5},
        )


class TransactionSpy(Enricher):
    """Records the connection's transaction status while enrichment runs."""

    prompt_version = "spy-v1"

    def __init__(self, conn: psycopg.Connection):
        self.conn = conn
        self.status: psycopg.pq.TransactionStatus | None = None

    def enrich(self, request: EnrichmentInput) -> EnrichmentOutcome:
        self.status = self.conn.info.transaction_status
        return StubEnricher().enrich(request)


def claim(db: psycopg.Connection, worker: str = WORKER, lease: float = 60.0):
    return claim_one(db, lease_seconds=lease, worker_id=worker)


def process(db, job, enricher, worker: str = WORKER, max_attempts: int = 3, fetcher=None) -> bool:
    return process_one(
        db,
        job,
        enricher,
        max_attempts=max_attempts,
        worker_id=worker,
        fetcher=fetcher or text_fetcher(),
    )


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


def content_version_rows(db: psycopg.Connection, link_id: str) -> list[dict]:
    with db.cursor(row_factory=dict_row) as cur:
        return cur.execute(
            "SELECT * FROM content_versions WHERE link_id = %s ORDER BY extracted_at",
            (link_id,),
        ).fetchall()


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
    def test_write_back_stores_result_linked_to_content_version(self, db, make_link):
        link_id, job_id, _ = make_link(note="why", goal="prep")
        job = claim(db)
        assert process(db, job, StubEnricher()) is True

        (version,) = content_version_rows(db, link_id)
        assert version["extracted_text"] == PAGE_TEXT
        assert version["content_hash"] == hashlib.sha256(PAGE_TEXT.encode()).hexdigest()

        rows = enrichment_rows(db, link_id)
        assert len(rows) == 1
        assert validation_errors(rows[0]["result"]) == []
        assert rows[0]["content_version_id"] == version["id"]
        assert rows[0]["content_hash"] == version["content_hash"]
        assert rows[0]["prompt_version"] == StubEnricher.prompt_version
        assert rows[0]["model_id"] == "stub"
        assert rows[0]["latency_ms"] is None
        assert rows[0]["token_usage"] is None

        row = fetch_job(db, job_id)
        assert row["status"] == "completed"
        assert row["completed_at"] is not None
        assert row["locked_until"] is None and row["locked_by"] is None
        assert link_status(db, link_id) == "enriched"

    def test_model_metadata_is_persisted(self, db, make_link):
        link_id, _, _ = make_link()
        assert process(db, claim(db), MetadataEnricher()) is True
        (row,) = enrichment_rows(db, link_id)
        assert row["prompt_version"] == "metadata-v1"
        assert row["model_id"] == "fake-model"
        assert row["latency_ms"] == 42
        assert row["token_usage"] == {"input_tokens": 10, "output_tokens": 5}

    def test_persisted_evidence_resolves_against_stored_text(self, db, make_link):
        link_id, _, _ = make_link()
        assert process(db, claim(db), StubEnricher()) is True
        (version,) = content_version_rows(db, link_id)
        (row,) = enrichment_rows(db, link_id)
        evidence = row["result"]["evidence"]
        assert evidence
        for item in evidence:
            slice_ = version["extracted_text"][item["start_offset"] : item["end_offset"]]
            assert slice_ == item["quote"]

    def test_slow_work_runs_without_open_transaction(self, db, make_link):
        make_link()
        spy = TransactionSpy(db)
        statuses: list[psycopg.pq.TransactionStatus] = []

        def spying_fetcher(url: str) -> FetchedPage:
            statuses.append(db.info.transaction_status)
            return text_fetcher()(url)

        assert process(db, claim(db), spy, fetcher=spying_fetcher) is True
        assert statuses == [psycopg.pq.TransactionStatus.IDLE]
        assert spy.status == psycopg.pq.TransactionStatus.IDLE

    def test_repeated_processing_yields_exactly_one_row(self, db, make_link):
        link_id, job_id, _ = make_link()
        job = claim(db)
        assert process(db, job, StubEnricher()) is True
        # Replay the same claim, as after a crash between enrich and write-back:
        # the content version is reused and the enrichment insert conflicts.
        assert process(db, job, StubEnricher()) is False
        assert len(content_version_rows(db, link_id)) == 1
        assert len(enrichment_rows(db, link_id)) == 1
        assert fetch_job(db, job_id)["status"] == "completed"
        assert link_status(db, link_id) == "enriched"

    def test_changed_content_creates_a_second_version(self, db, make_link):
        link_id, job_id, _ = make_link()
        assert process(db, claim(db), StubEnricher()) is True
        # Reprocess after the page changed (simulated via requeue).
        db.execute(
            "UPDATE enrichment_jobs SET status = 'pending', available_at = now() WHERE id = %s",
            (job_id,),
        )
        changed = PAGE_TEXT + " Updated with new material."
        assert process(db, claim(db), StubEnricher(), fetcher=text_fetcher(changed)) is True
        versions = content_version_rows(db, link_id)
        assert len(versions) == 2
        assert {v["extracted_text"] for v in versions} == {PAGE_TEXT, changed}
        assert len(enrichment_rows(db, link_id)) == 2

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
    def test_blocked_destination_fails_immediately(self, db, make_link):
        link_id, job_id, _ = make_link()
        assert process(db, claim(db), StubEnricher(), fetcher=blocked_fetcher) is False

        row = fetch_job(db, job_id)
        assert row["status"] == "failed"
        assert row["attempts"] == 1
        assert row["last_error"].startswith("blocked_url: ")
        assert row["locked_until"] is None and row["locked_by"] is None
        assert link_status(db, link_id) == "failed"
        assert content_version_rows(db, link_id) == []
        assert enrichment_rows(db, link_id) == []
        # Not rescheduled: a failed job is never claimable again.
        assert claim(db) is None

    def test_empty_content_fails_immediately(self, db, make_link):
        link_id, job_id, _ = make_link()
        assert process(db, claim(db), StubEnricher(), fetcher=text_fetcher("   ")) is False
        row = fetch_job(db, job_id)
        assert row["status"] == "failed"
        assert row["attempts"] == 1
        assert row["last_error"].startswith("empty_content: ")
        assert link_status(db, link_id) == "failed"

    def test_transient_fetch_failure_reschedules_with_backoff(self, db, make_link):
        link_id, job_id, _ = make_link()

        def transient(url: str) -> FetchedPage:
            raise FetchTransientError("fetch_timeout", f"budget exceeded for {url}")

        assert process(db, claim(db), StubEnricher(), fetcher=transient) is False
        row = fetch_job(db, job_id)
        assert row["status"] == "pending"
        assert row["attempts"] == 1
        assert row["last_error"].startswith("fetch_timeout: ")
        assert row["scheduled_ahead"] is True
        assert 3 < row["delay_seconds"] <= 5
        assert link_status(db, link_id) == "pending"

    def test_transient_enrich_failure_reschedules_with_backoff(self, db, make_link):
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

    def test_invalid_model_output_is_transient(self, db, make_link):
        _, job_id, _ = make_link()
        assert process(db, claim(db), InvalidOutputEnricher()) is False
        row = fetch_job(db, job_id)
        assert row["status"] == "pending"
        assert row["last_error"].startswith("invalid_model_output: ")

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


class TestEvidenceDropping:
    def test_unresolvable_evidence_is_dropped_before_persistence(self, db, make_link):
        link_id, _, _ = make_link()

        class TamperedEnricher(Enricher):
            prompt_version = "tampered-v1"

            def enrich(self, request: EnrichmentInput) -> EnrichmentOutcome:
                outcome = StubEnricher().enrich(request)
                bad = outcome.result.evidence[0].model_copy(
                    update={"quote": "this quote is not in the page"}
                )
                result = outcome.result.model_copy(
                    update={"evidence": [outcome.result.evidence[0], bad]}
                )
                return EnrichmentOutcome(result=result, model_id="tampered")

        assert process(db, claim(db), TamperedEnricher()) is True
        (row,) = enrichment_rows(db, link_id)
        evidence = row["result"]["evidence"]
        assert len(evidence) == 1
        assert evidence[0]["quote"] != "this quote is not in the page"
