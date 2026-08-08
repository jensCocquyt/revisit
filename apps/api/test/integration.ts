import { randomUUID } from "node:crypto";
import pg from "pg";

// Integration tests require a migrated PostgreSQL. They fail loudly rather
// than skip silently, so a missing database can never look like a green run.
export function integrationDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set for integration tests. " +
        "Start the database with `docker compose up -d postgres migrate` " +
        "and export DATABASE_URL (see .env.example).",
    );
  }
  return url;
}

export function integrationPool(): pg.Pool {
  return new pg.Pool({ connectionString: integrationDatabaseUrl(), connectionTimeoutMillis: 5000 });
}

export interface RowCounts {
  links: number;
  jobs: number;
  keys: number;
}

// Row counts scoped to one submission (by its unique url and idempotency
// key), so parallel tests sharing the database cannot interfere.
export async function countRows(
  pool: pg.Pool,
  scope: { url: string; key: string },
): Promise<RowCounts> {
  const [links, jobs, keys] = await Promise.all([
    pool.query("SELECT count(*)::int AS n FROM links WHERE url = $1", [scope.url]),
    pool.query(
      `SELECT count(*)::int AS n FROM enrichment_jobs j
       JOIN links l ON l.id = j.link_id WHERE l.url = $1`,
      [scope.url],
    ),
    pool.query("SELECT count(*)::int AS n FROM idempotency_keys WHERE key = $1", [scope.key]),
  ]);
  return { links: links.rows[0].n, jobs: jobs.rows[0].n, keys: keys.rows[0].n };
}

// Unique per-test values so tests never collide on shared tables.
export function uniqueSubmission(label: string): { url: string; key: string } {
  const id = randomUUID();
  return { url: `https://example.com/${label}/${id}`, key: `test-${label}-${id}` };
}
