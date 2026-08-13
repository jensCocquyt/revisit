"""Claiming and processing over the enrichment_jobs queue.

Transaction shape: claim in one short transaction; fetch, extraction, and
enrichment run with no transaction open; content-version storage and the
write-back (result + statuses) each use their own short transaction.
Connections must be in autocommit mode so statements outside
`conn.transaction()` blocks do not hold an implicit transaction open during
slow work.
"""

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass

import psycopg

from worker import fetch as fetch_mod
from worker.content import store_content_version
from worker.contract import NonRevisitResult, RevisitResult
from worker.enricher import Enricher, EnricherError, EnrichmentInput, EnrichmentOutcome
from worker.evidence import resolve_evidence
from worker.extract import ExtractedContent, extract_content
from worker.fetch import FetchedPage, FetchTerminalError, FetchTransientError

log = logging.getLogger("worker")

BACKOFF_BASE_SECONDS = 5.0
BACKOFF_CAP_SECONDS = 60.0

Fetcher = Callable[[str], FetchedPage]

_CLAIM_SQL = """
UPDATE enrichment_jobs
SET status = 'processing',
    locked_until = now() + make_interval(secs => %(lease)s),
    locked_by = %(worker_id)s,
    updated_at = now()
WHERE id = (
  SELECT id FROM enrichment_jobs
  WHERE (status = 'pending' AND available_at <= now())
     OR (status = 'processing' AND locked_until <= now())
  ORDER BY available_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING id, link_id, attempts
"""


@dataclass(frozen=True)
class ClaimedJob:
    id: str
    link_id: str
    attempts: int


def backoff_seconds(attempts: int) -> float:
    return min(BACKOFF_BASE_SECONDS * 2**attempts, BACKOFF_CAP_SECONDS)


def claim_one(
    conn: psycopg.Connection, *, lease_seconds: float, worker_id: str
) -> ClaimedJob | None:
    with conn.transaction():
        row = conn.execute(_CLAIM_SQL, {"lease": lease_seconds, "worker_id": worker_id}).fetchone()
    if row is None:
        return None
    job = ClaimedJob(id=str(row[0]), link_id=str(row[1]), attempts=row[2])
    _log_event("job claimed", job)
    return job


def process_one(
    conn: psycopg.Connection,
    job: ClaimedJob,
    enricher: Enricher,
    *,
    max_attempts: int,
    worker_id: str,
    fetcher: Fetcher | None = None,
) -> bool:
    """Run the full pipeline for a claimed job. Returns True on success.

    fetch -> extract -> store content version -> enrich -> verify evidence
    -> persist. `fetcher` is injectable for tests; the default fetches with
    the guard and limits from the environment.
    """
    row = conn.execute("SELECT url, note, goal FROM links WHERE id = %s", (job.link_id,)).fetchone()
    if row is None:
        # Should not happen (FK); treat as a failure so the job does not spin hot.
        _fail(
            conn, job, "link_missing: no links row", max_attempts=max_attempts, worker_id=worker_id
        )
        return False
    url, note, goal = row

    try:
        page = (fetcher or fetch_mod.fetch_page)(url)
        content = extract_content(page.body, page.content_type)
    except FetchTerminalError as exc:
        _fail(conn, job, str(exc), max_attempts=max_attempts, worker_id=worker_id, terminal=True)
        return False
    except FetchTransientError as exc:
        _fail(conn, job, str(exc), max_attempts=max_attempts, worker_id=worker_id)
        return False
    except Exception as exc:  # noqa: BLE001 - unexpected fetch errors follow the retry policy
        detail = f"{type(exc).__name__}: {exc}"[:300]
        _fail(conn, job, f"fetch_error: {detail}", max_attempts=max_attempts, worker_id=worker_id)
        return False

    content_version_id = store_content_version(conn, job.link_id, content)

    try:
        outcome = enricher.enrich(EnrichmentInput(content=content.text, note=note, goal=goal))
    except EnricherError as exc:
        _fail(conn, job, str(exc), max_attempts=max_attempts, worker_id=worker_id)
        return False
    except Exception as exc:  # noqa: BLE001 - any enricher error follows the retry policy
        detail = f"{type(exc).__name__}: {exc}"[:300]
        _fail(conn, job, f"enrich_error: {detail}", max_attempts=max_attempts, worker_id=worker_id)
        return False

    result, evidence_dropped = resolve_evidence(outcome.result, content.text)
    if evidence_dropped:
        _log_event("evidence dropped", job, evidence_dropped=evidence_dropped)
    return _complete(
        conn,
        job,
        outcome,
        result,
        content,
        content_version_id,
        prompt_version=enricher.prompt_version,
        worker_id=worker_id,
    )


def _complete(
    conn: psycopg.Connection,
    job: ClaimedJob,
    outcome: EnrichmentOutcome,
    result: NonRevisitResult | RevisitResult,
    content: ExtractedContent,
    content_version_id: str,
    *,
    prompt_version: str,
    worker_id: str,
) -> bool:
    with conn.transaction():
        # At-least-once processing: a retry hitting the unique key is success.
        conn.execute(
            """
            INSERT INTO enrichments
              (link_id, content_version_id, content_hash, prompt_version,
               contract_version, result, model_id, latency_ms, token_usage)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s::jsonb)
            ON CONFLICT (link_id, content_hash, prompt_version) DO NOTHING
            """,
            (
                job.link_id,
                content_version_id,
                content.content_hash,
                prompt_version,
                result.contract_version,
                result.model_dump_json(),
                outcome.model_id,
                outcome.latency_ms,
                json.dumps(outcome.token_usage) if outcome.token_usage is not None else None,
            ),
        )
        claimed = conn.execute(
            """
            UPDATE enrichment_jobs
            SET status = 'completed', completed_at = now(),
                locked_until = NULL, locked_by = NULL, updated_at = now()
            WHERE id = %s AND locked_by = %s AND status = 'processing'
            """,
            (job.id, worker_id),
        )
        if claimed.rowcount == 0:
            # Lease expired and another worker reclaimed the job: it owns the
            # statuses now; our result insert above was idempotent either way.
            _log_event("stale claim, write-back skipped", job)
            return False
        conn.execute(
            "UPDATE links SET status = 'enriched', updated_at = now() WHERE id = %s",
            (job.link_id,),
        )
    _log_event("job completed", job)
    return True


def _fail(
    conn: psycopg.Connection,
    job: ClaimedJob,
    last_error: str,
    *,
    max_attempts: int,
    worker_id: str,
    terminal: bool = False,
) -> None:
    # Terminal failures (blocked destination, unsupported content, ...) fail
    # immediately; transient ones become terminal on the final allowed attempt.
    terminal = terminal or job.attempts + 1 >= max_attempts
    last_error = last_error[:300]
    with conn.transaction():
        if terminal:
            claimed = conn.execute(
                """
                UPDATE enrichment_jobs
                SET status = 'failed', attempts = attempts + 1, last_error = %s,
                    locked_until = NULL, locked_by = NULL, updated_at = now()
                WHERE id = %s AND locked_by = %s AND status = 'processing'
                """,
                (last_error, job.id, worker_id),
            )
            if claimed.rowcount:
                conn.execute(
                    "UPDATE links SET status = 'failed', updated_at = now() WHERE id = %s",
                    (job.link_id,),
                )
        else:
            claimed = conn.execute(
                """
                UPDATE enrichment_jobs
                SET status = 'pending', attempts = attempts + 1, last_error = %s,
                    available_at = now() + make_interval(secs => %s),
                    locked_until = NULL, locked_by = NULL, updated_at = now()
                WHERE id = %s AND locked_by = %s AND status = 'processing'
                """,
                (last_error, backoff_seconds(job.attempts), job.id, worker_id),
            )
    if claimed.rowcount == 0:
        _log_event("stale claim, write-back skipped", job)
    elif terminal:
        _log_event("job failed", job, last_error=last_error)
    else:
        _log_event("job rescheduled", job, last_error=last_error)


def _log_event(msg: str, job: ClaimedJob, **extra: str | int) -> None:
    log.info(json.dumps({"msg": msg, "job_id": job.id, "link_id": job.link_id, **extra}))
