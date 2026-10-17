import type pg from "pg";
import type { Item, ItemDetail, ItemKind } from "../contract.js";
import { type Queryable, withTransaction } from "./connection.js";

export type NewItem = {
  kind: ItemKind;
  url: string | null;
  title: string | null;
  note: string | null;
  body: string | null;
};

export type ItemFilters = { kind?: ItemKind; from?: Date; to?: Date };

export type ReadContent = { title: string | null; body: string | null; error: string | null };

export type EmbeddedPassage = { text: string; embedding: number[] };

// Undefined when a link with the same address is already saved.
export async function insertItem(db: Queryable, item: NewItem): Promise<Item | undefined> {
  const { rows } = await db.query<ItemRow>(
    `INSERT INTO items (kind, url, title, note, body) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (url) DO NOTHING
     RETURNING ${itemColumns()}`,
    [item.kind, item.url, item.title, item.note, item.body],
  );
  return rows[0] && toItem(rows[0]);
}

export async function findLinkItem(db: Queryable, url: string): Promise<Item | undefined> {
  const { rows } = await db.query<ItemRow>(
    `SELECT ${itemColumns()} FROM items WHERE kind = 'link' AND url = $1 LIMIT 1`,
    [url],
  );
  return rows[0] && toItem(rows[0]);
}

export async function listRecentItems(
  db: Queryable,
  filters: ItemFilters,
  limit: number,
): Promise<Item[]> {
  const { rows } = await db.query<ItemRow>(
    `SELECT ${itemColumns()} FROM items
     WHERE ($1::text IS NULL OR kind = $1)
       AND ($2::timestamptz IS NULL OR created_at >= $2)
       AND ($3::timestamptz IS NULL OR created_at < $3)
     ORDER BY created_at DESC, id DESC
     LIMIT $4`,
    [filters.kind ?? null, filters.from ?? null, filters.to ?? null, limit],
  );
  return rows.map(toItem);
}

export async function findItem(db: Queryable, id: string): Promise<ItemDetail | undefined> {
  const { rows } = await db.query<ItemDetailRow>(
    `SELECT ${itemColumns()}, body FROM items WHERE id = $1`,
    [id],
  );
  return rows[0] && toItemDetail(rows[0]);
}

export async function deleteItem(db: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await db.query("DELETE FROM items WHERE id = $1", [id]);
  return rowCount === 1;
}

// Failed items and links whose page could not be read both carry an error.
export async function requeueItemWithError(db: Queryable, id: string): Promise<Item | undefined> {
  const { rows } = await db.query<ItemRow>(
    `UPDATE items SET status = 'pending', error = NULL, processed_at = NULL
     WHERE id = $1 AND error IS NOT NULL
     RETURNING ${itemColumns()}`,
    [id],
  );
  return rows[0] && toItem(rows[0]);
}

export async function claimNextPendingItem(db: Queryable): Promise<ItemDetail | undefined> {
  const { rows } = await db.query<ItemDetailRow>(
    `UPDATE items SET status = 'processing'
     WHERE id = (SELECT id FROM items WHERE status = 'pending' ORDER BY created_at, id LIMIT 1)
     RETURNING ${itemColumns()}, body`,
  );
  return rows[0] && toItemDetail(rows[0]);
}

export async function resetInFlightItems(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    "UPDATE items SET status = 'pending' WHERE status = 'processing'",
  );
  return rowCount ?? 0;
}

export async function completeItem(
  pool: pg.Pool,
  id: string,
  content: ReadContent,
  passages: EmbeddedPassage[],
): Promise<void> {
  await withTransaction(pool, async (client) => {
    await client.query("DELETE FROM passages WHERE item_id = $1", [id]);
    await client.query(
      `INSERT INTO passages (item_id, position, text, embedding)
       SELECT $1, passage.position - 1, passage.text, passage.embedding::vector
       FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS passage (text, embedding, position)`,
      [id, passages.map((p) => p.text), passages.map((p) => JSON.stringify(p.embedding))],
    );
    await client.query(
      `UPDATE items SET title = $2, body = $3, error = $4, status = 'ready', processed_at = now()
       WHERE id = $1`,
      [id, content.title, content.body, content.error],
    );
  });
}

export async function failItem(db: Queryable, id: string, error: string): Promise<void> {
  await db.query(
    "UPDATE items SET status = 'failed', error = $2, processed_at = now() WHERE id = $1",
    [id, error],
  );
}

export function itemColumns(table = "items"): string {
  return [
    "id",
    "kind",
    "url",
    "title",
    "note",
    "status",
    "error",
    'created_at AS "createdAt"',
    'processed_at AS "processedAt"',
  ]
    .map((column) => `${table}.${column}`)
    .join(", ");
}

export type ItemRow = Omit<Item, "createdAt" | "processedAt"> & {
  createdAt: Date;
  processedAt: Date | null;
};

export function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    kind: row.kind,
    url: row.url,
    title: row.title,
    note: row.note,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
  };
}

type ItemDetailRow = ItemRow & { body: string | null };

function toItemDetail(row: ItemDetailRow): ItemDetail {
  return { ...toItem(row), body: row.body };
}
