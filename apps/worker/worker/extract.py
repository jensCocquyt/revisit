"""Readable-text extraction from fetched pages.

Deterministic: the same body always yields byte-identical extracted text.
Raw HTML is dropped after extraction; only the extracted record is stored.
"""

import hashlib
from dataclasses import dataclass
from typing import Any

import trafilatura

from worker.errors import FetchTerminalError


@dataclass(frozen=True)
class ExtractedContent:
    text: str
    content_hash: str  # sha256 over the extracted text
    title: str | None
    metadata: dict[str, str]


def extract_content(body: str, content_type: str) -> ExtractedContent:
    if content_type == "text/plain":
        text, doc = body.strip(), None
    else:
        text = (trafilatura.extract(body, include_comments=False) or "").strip()
        doc = trafilatura.extract_metadata(body)
    if not text:
        raise FetchTerminalError("empty_content", "no readable text extracted")
    return ExtractedContent(
        text=text,
        content_hash=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        title=_title(doc),
        metadata=_metadata(doc),
    )


def _title(doc: Any | None) -> str | None:
    return (doc.title or None) if doc is not None else None


def _metadata(doc: Any | None) -> dict[str, str]:
    if doc is None:
        return {}
    return {
        name: value
        for name in ("author", "date", "sitename", "description")
        if isinstance(value := getattr(doc, name, None), str) and value
    }
