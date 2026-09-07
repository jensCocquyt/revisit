import type pg from "pg";
import {
  type CreateLinkWithJobInput,
  IdempotencyKeyConflictError,
  type LinkPage,
  type LinkRow,
  type ListLinksInput,
} from "./types.js";

export async function getLink(pool: pg.Pool, id: string): Promise<LinkRow | null> {
  const result = await pool.query<RawLinkRow>(
    `SELECT ${LINK_COLUMNS} FROM links l ${LATEST_ENRICHMENT_JOIN} WHERE l.id = $1`,
    [id],
  );
  return result.rows[0] ? mapLink(result.rows[0]) : null;
}

// Keyset pagination: the cursor is the last served link's id, and the page
// continues strictly after that row's (created_at, id) position.
export async function listLinks(pool: pg.Pool, input: ListLinksInput): Promise<LinkPage> {
  const params: unknown[] = [];
  const conditions: string[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (input.status) {
    conditions.push(`l.status = ${bind(input.status)}`);
  }
  if (input.tag) {
    conditions.push(`latest.result->'tags' ? ${bind(input.tag)}`);
  }
  if (input.afterId) {
    conditions.push(
      `(l.created_at, l.id) < (SELECT c.created_at, c.id FROM links c WHERE c.id = ${bind(input.afterId)})`,
    );
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query<RawLinkRow>(
    `SELECT ${LINK_COLUMNS} FROM links l ${LATEST_ENRICHMENT_JOIN}
     ${where}
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT ${bind(input.limit + 1)}`,
    params,
  );
  const rows = result.rows.slice(0, input.limit);
  return { items: rows.map(mapLink), hasMore: result.rows.length > input.limit };
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
       RETURNING id, url, note, goal, status, created_at, updated_at, NULL AS latest_result`,
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

const LINK_COLUMNS =
  "l.id, l.url, l.note, l.goal, l.status, l.created_at, l.updated_at, latest.result AS latest_result";

const LATEST_ENRICHMENT_JOIN = `LEFT JOIN LATERAL (
  SELECT e.result FROM enrichments e WHERE e.link_id = l.id
  ORDER BY e.created_at DESC LIMIT 1
) latest ON true`;

interface RawLinkRow {
  id: string;
  url: string;
  note: string | null;
  goal: string | null;
  status: LinkRow["status"];
  created_at: Date;
  updated_at: Date;
  latest_result: unknown;
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
    latest_result: row.latest_result ?? null,
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
