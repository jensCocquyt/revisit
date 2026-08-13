"""Extraction determinism and behavior over fixed HTML snapshots."""

import hashlib
from pathlib import Path

import pytest

from worker.extract import extract_content
from worker.safe_fetch import FetchTerminalError

FIXTURES = Path(__file__).parent / "fixtures"
ARTICLE = (FIXTURES / "article.html").read_text(encoding="utf-8")
EMPTY = (FIXTURES / "empty.html").read_text(encoding="utf-8")


def test_extraction_is_deterministic():
    first = extract_content(ARTICLE, "text/html")
    second = extract_content(ARTICLE, "text/html")
    assert first == second


def test_article_body_is_extracted_without_boilerplate():
    content = extract_content(ARTICLE, "text/html")
    assert "Replication copies data from a primary database" in content.text
    assert "secret-tracker-token" not in content.text
    assert "analytics.js" not in content.text


def test_title_and_metadata_are_captured():
    content = extract_content(ARTICLE, "text/html")
    assert content.title == "Understanding Database Replication"
    assert content.metadata.get("author") == "Ada Example"


def test_content_hash_is_sha256_of_text():
    content = extract_content(ARTICLE, "text/html")
    assert content.content_hash == hashlib.sha256(content.text.encode("utf-8")).hexdigest()


def test_empty_page_is_terminal():
    with pytest.raises(FetchTerminalError, match="^empty_content"):
        extract_content(EMPTY, "text/html")


def test_plain_text_passes_through():
    content = extract_content("  plain text body\nsecond line  ", "text/plain")
    assert content.text == "plain text body\nsecond line"
    assert content.title is None
    assert content.metadata == {}


def test_blank_plain_text_is_terminal():
    with pytest.raises(FetchTerminalError, match="^empty_content"):
        extract_content("   \n  ", "text/plain")
