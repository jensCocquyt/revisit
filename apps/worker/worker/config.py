import os


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is required")
    return url


def enricher_name() -> str:
    return os.environ.get("ENRICHER", "stub")


def heartbeat_seconds() -> float:
    return float(os.environ.get("WORKER_HEARTBEAT_SECONDS", "30"))
