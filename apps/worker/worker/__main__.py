"""Worker entry point: poll loop claiming and processing enrichment jobs.

Claims chain immediately while eligible jobs exist; the loop sleeps only
after an empty poll. Connection loss is retried with a fresh connection.
"""

import json
import logging
import time

import psycopg

from worker import jobs
from worker.config import (
    database_url,
    enricher_name,
    lease_seconds,
    max_attempts,
    poll_seconds,
    worker_id,
)
from worker.enricher import get_enricher

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("worker")


def main() -> None:
    enricher = get_enricher(enricher_name())
    me = worker_id()
    log.info(json.dumps({"msg": "worker started", "enricher": enricher_name(), "worker_id": me}))
    conn: psycopg.Connection | None = None
    while True:
        try:
            if conn is None or conn.closed:
                conn = psycopg.connect(database_url(), autocommit=True, connect_timeout=5)
            job = jobs.claim_one(conn, lease_seconds=lease_seconds(), worker_id=me)
            if job is None:
                time.sleep(poll_seconds())
                continue
            # A connection drop mid-processing abandons the claim; the lease
            # expires and the job becomes claimable again.
            jobs.process_one(conn, job, enricher, max_attempts=max_attempts(), worker_id=me)
        except psycopg.OperationalError as exc:
            log.error(json.dumps({"msg": "database unavailable", "error": str(exc)[:300]}))
            conn = None
            time.sleep(poll_seconds())


if __name__ == "__main__":
    main()
