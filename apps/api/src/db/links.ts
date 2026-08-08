import type pg from "pg";
import { type CreateLinkWithJobInput, IdempotencyKeyConflictError, type LinkRow } from "./types.js";

export async function getLink(pool: pg.Pool, id: string): Promise<LinkRow | null> {
  const result = await pool.query<RawLinkRow>(
    "SELECT id, url, note, goal, status, created_at, updated_at FROM links WHERE id = $1",
    [id],
  );
  return result.rows[0] ? mapLink(result.rows[0]) : null;
}

// Link, enrichment job, and idempotency key commit in one transaction: a
// committed link always has exactly one initial job, and a stored key always
// points at a committed link.
export async function createLinkWithJob(
  pool: pg.Pool,
  input: CreateLinkWithJobInput,
): Promise<LinkRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const linkResult = await client.query<RawLinkRow>(
      `INSERT INTO links (url, normalized_url, note, goal)
       VALUES ($1, $2, $3, $4)
       RETURNING id, url, note, goal, status, created_at, updated_at`,
      [input.url, input.normalizedUrl, input.note, input.goal],
    );
    const link = mapLink(linkResult.rows[0]);
    await client.query("INSERT INTO enrichment_jobs (link_id) VALUES ($1)", [link.id]);
    await client.query(
      "INSERT INTO idempotency_keys (key, request_hash, link_id) VALUES ($1, $2, $3)",
      [input.idempotencyKey, input.requestHash, link.id],
    );
    await client.query("COMMIT");
    return link;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (isIdempotencyKeyViolation(err)) {
      throw new IdempotencyKeyConflictError();
    }
    throw err;
  } finally {
    client.release();
  }
}

interface RawLinkRow {
  id: string;
  url: string;
  note: string | null;
  goal: string | null;
  status: LinkRow["status"];
  created_at: Date;
  updated_at: Date;
}

function mapLink(row: RawLinkRow): LinkRow {
  return {
    id: row.id,
    url: row.url,
    note: row.note,
    goal: row.goal,
    status: row.status,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function isIdempotencyKeyViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505" &&
    (err as { constraint?: string }).constraint === "idempotency_keys_pkey"
  );
}
