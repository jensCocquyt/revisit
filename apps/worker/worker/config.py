import os
import socket


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is required")
    return url


def enricher_name() -> str:
    return os.environ.get("ENRICHER", "stub")


def poll_seconds() -> float:
    return float(os.environ.get("WORKER_POLL_SECONDS", "2"))


def lease_seconds() -> float:
    return float(os.environ.get("WORKER_LEASE_SECONDS", "60"))


def max_attempts() -> int:
    return int(os.environ.get("WORKER_MAX_ATTEMPTS", "3"))


def worker_id() -> str:
    return f"{socket.gethostname()}-{os.getpid()}"
