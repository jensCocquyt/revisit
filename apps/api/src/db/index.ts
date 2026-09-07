import pg from "pg";
import { getEnrichment } from "./enrichments.js";
import { findIdempotencyKey } from "./idempotency-keys.js";
import { createLinkWithJob, getLink, listLinks } from "./links.js";
import type { Db } from "./types.js";

export * from "./types.js";

// One pool per process; query functions live in per-table modules and receive
// the pool explicitly.
export function createDb(databaseUrl: string): Db & { end(): Promise<void> } {
  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  pool.on("error", (err) => {
    console.error(JSON.stringify({ msg: "pg pool error", error: err.message }));
  });
  return {
    ping: async () => {
      await pool.query("SELECT 1");
    },
    getLink: (id) => getLink(pool, id),
    listLinks: (input) => listLinks(pool, input),
    getEnrichment: (linkId) => getEnrichment(pool, linkId),
    findIdempotencyKey: (key) => findIdempotencyKey(pool, key),
    createLinkWithJob: (input) => createLinkWithJob(pool, input),
    end: () => pool.end(),
  };
}
