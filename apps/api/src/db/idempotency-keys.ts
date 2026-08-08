import type pg from "pg";
import type { IdempotencyKeyRow } from "./types.js";

export async function findIdempotencyKey(
  pool: pg.Pool,
  key: string,
): Promise<IdempotencyKeyRow | null> {
  const result = await pool.query(
    "SELECT key, request_hash, link_id FROM idempotency_keys WHERE key = $1",
    [key],
  );
  const row = result.rows[0];
  return row ? { key: row.key, requestHash: row.request_hash, linkId: row.link_id } : null;
}
