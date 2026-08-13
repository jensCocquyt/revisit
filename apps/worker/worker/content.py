"""Versioned storage of extracted content in content_versions."""

import json

import psycopg

from worker.extract import ExtractedContent


def store_content_version(conn: psycopg.Connection, link_id: str, content: ExtractedContent) -> str:
    """Store the extracted content, reusing an existing identical version.

    Idempotent under at-least-once processing via the (link_id, content_hash)
    unique key. One short transaction; committed before enrichment starts so
    the version that evidence references exists even if the model call dies.
    """
    with conn.transaction():
        conn.execute(
            """
            INSERT INTO content_versions (link_id, content_hash, extracted_text, title, metadata)
            VALUES (%s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (link_id, content_hash) DO NOTHING
            """,
            (
                link_id,
                content.content_hash,
                content.text,
                content.title,
                json.dumps(content.metadata) if content.metadata else None,
            ),
        )
        row = conn.execute(
            "SELECT id FROM content_versions WHERE link_id = %s AND content_hash = %s",
            (link_id, content.content_hash),
        ).fetchone()
    assert row is not None  # the insert above guarantees the row exists
    return str(row[0])
