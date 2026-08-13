"""Readable-text extraction from fetched pages.

Deterministic: the same body always yields byte-identical extracted text.
Raw HTML is dropped after extraction; only the extracted record is stored.
"""

import hashlib
from dataclasses import dataclass

import trafilatura

from worker.fetch import FetchTerminalError


@dataclass(frozen=True)
class ExtractedContent:
    text: str
    content_hash: str  # sha256 over the extracted text
    title: str | None
    metadata: dict[str, str]


def extract_content(body: str, content_type: str) -> ExtractedContent:
    if content_type == "text/plain":
        text = body.strip()
        title, metadata = None, {}
    else:
        text = (trafilatura.extract(body, include_comments=False) or "").strip()
        title, metadata = _metadata(body)
    if not text:
        raise FetchTerminalError("empty_content", "no readable text extracted")
    return ExtractedContent(
        text=text,
        content_hash=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        title=title,
        metadata=metadata,
    )


def _metadata(body: str) -> tuple[str | None, dict[str, str]]:
    doc = trafilatura.extract_metadata(body)
    if doc is None:
        return None, {}
    fields = {
        name: value
        for name in ("author", "date", "sitename", "description")
        if isinstance(value := getattr(doc, name, None), str) and value
    }
    return doc.title or None, fields
