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


def fetch_max_redirects() -> int:
    return int(os.environ.get("FETCH_MAX_REDIRECTS", "5"))


def fetch_max_bytes() -> int:
    return int(os.environ.get("FETCH_MAX_BYTES", "2000000"))


def fetch_timeout_seconds() -> float:
    return float(os.environ.get("FETCH_TIMEOUT_SECONDS", "15"))


def fetch_allowed_content_types() -> frozenset[str]:
    raw = os.environ.get(
        "FETCH_ALLOWED_CONTENT_TYPES", "text/html,application/xhtml+xml,text/plain"
    )
    return frozenset(part.strip().lower() for part in raw.split(",") if part.strip())


def fetch_allowed_hosts() -> frozenset[str]:
    raw = os.environ.get("FETCH_ALLOWED_HOSTS", "")
    return frozenset(part.strip() for part in raw.split(",") if part.strip())


def bedrock_model_id() -> str:
    return os.environ.get("BEDROCK_MODEL_ID", "")


def worker_id() -> str:
    return f"{socket.gethostname()}-{os.getpid()}"
