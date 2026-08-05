import json
from pathlib import Path

import pytest

from worker.contract import SCHEMA_PATH, is_valid, validation_errors

FIXTURES_DIR = SCHEMA_PATH.parent / "fixtures"


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


valid_fixtures = sorted(FIXTURES_DIR.glob("valid-*.json"))
invalid_fixtures = sorted(FIXTURES_DIR.glob("invalid-*.json"))


def test_shared_fixtures_exist():
    assert valid_fixtures, "expected valid fixtures in contracts/enrichment/fixtures"
    assert invalid_fixtures, "expected invalid fixtures in contracts/enrichment/fixtures"


@pytest.mark.parametrize("path", valid_fixtures, ids=lambda p: p.name)
def test_valid_fixture_accepted(path: Path):
    assert validation_errors(_load(path)) == []


@pytest.mark.parametrize("path", invalid_fixtures, ids=lambda p: p.name)
def test_invalid_fixture_rejected(path: Path):
    assert not is_valid(_load(path))
