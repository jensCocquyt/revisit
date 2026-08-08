import pg from "pg";

export interface LinkRow {
  id: string;
  url: string;
  note: string | null;
  goal: string | null;
  status: "pending" | "enriched" | "failed";
  created_at: string;
  updated_at: string;
}

export interface IdempotencyKeyRow {
  key: string;
  requestHash: string;
  linkId: string;
}

export interface CreateLinkWithJobInput {
  url: string;
  normalizedUrl: string;
  note: string | null;
  goal: string | null;
  idempotencyKey: string;
  requestHash: string;
}

// The submitted idempotency key already exists; the caller decides between
// replaying the stored link and reporting a conflict.
export class IdempotencyKeyConflictError extends Error {
  constructor() {
    super("idempotency key already exists");
    this.name = "IdempotencyKeyConflictError";
  }
}

export interface Db {
  ping(): Promise<void>;
  getLink(id: string): Promise<LinkRow | null>;
  findIdempotencyKey(key: string): Promise<IdempotencyKeyRow | null>;
  createLinkWithJob(input: CreateLinkWithJobInput): Promise<LinkRow>;
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

export function createDb(databaseUrl: string): Db & { end(): Promise<void> } {
  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  pool.on("error", (err) => {
    console.error(JSON.stringify({ msg: "pg pool error", error: err.message }));
  });
  return {
    async ping() {
      await pool.query("SELECT 1");
    },

    async getLink(id) {
      const result = await pool.query<RawLinkRow>(
        "SELECT id, url, note, goal, status, created_at, updated_at FROM links WHERE id = $1",
        [id],
      );
      return result.rows[0] ? mapLink(result.rows[0]) : null;
    },

    async findIdempotencyKey(key) {
      const result = await pool.query(
        "SELECT key, request_hash, link_id FROM idempotency_keys WHERE key = $1",
        [key],
      );
      const row = result.rows[0];
      return row ? { key: row.key, requestHash: row.request_hash, linkId: row.link_id } : null;
    },

    // Link, enrichment job, and idempotency key commit in one transaction:
    // a committed link always has exactly one initial job, and a stored key
    // always points at a committed link.
    async createLinkWithJob(input) {
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
    },

    async end() {
      await pool.end();
    },
  };
}
