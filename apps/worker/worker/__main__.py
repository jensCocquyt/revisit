"""Worker entry point: idle heartbeat loop.

Job claiming and processing arrive in the next change; the foundation
loop only proves the container runs and can be observed.
"""

import json
import logging
import time

from worker.config import enricher_name, heartbeat_seconds
from worker.enricher import get_enricher

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("worker")


def main() -> None:
    # Fail fast on bad configuration; the enricher is exercised once jobs exist.
    get_enricher(enricher_name())
    interval = heartbeat_seconds()
    log.info(json.dumps({"msg": "worker started", "enricher": enricher_name()}))
    while True:
        log.info(json.dumps({"msg": "heartbeat"}))
        time.sleep(interval)


if __name__ == "__main__":
    main()
