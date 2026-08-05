"""Validation of enrichment results against the shared v1 contract."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

# Repo layout is preserved in the container image, so the schema resolves
# identically in local checkouts and inside Docker.
SCHEMA_PATH = Path(__file__).resolve().parents[3] / "contracts" / "enrichment" / "v1.schema.json"

CONTRACT_VERSION = "v1"


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return Draft202012Validator(schema, format_checker=FormatChecker())


def validation_errors(result: Any) -> list[str]:
    """Return a list of human-readable contract violations; empty means valid."""
    errors = sorted(_validator().iter_errors(result), key=lambda e: list(e.absolute_path))
    return [f"/{'/'.join(str(p) for p in e.absolute_path)}: {e.message}" for e in errors]


def is_valid(result: Any) -> bool:
    return not validation_errors(result)
