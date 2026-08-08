"""Container health probe: verify the worker can reach the database.

Usage: python -m worker.healthcheck
Exit code 0 when healthy, 1 otherwise.
"""

import sys

import psycopg

from worker.config import database_url


def check(connect=psycopg.connect) -> int:
    try:
        with connect(database_url(), connect_timeout=5) as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        return 0
    except Exception as exc:  # noqa: BLE001 - any failure means unhealthy
        print(f"healthcheck failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(check())
