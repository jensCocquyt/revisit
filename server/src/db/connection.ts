import pg from "pg";
import { describeError, log } from "../log.js";

// A connection the database drops while idle is reported here; unheard, it ends the process.
export function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  pool.on("error", (error) =>
    log("warn", "database connection dropped", { error: describeError(error) }),
  );
  return pool;
}

export type Queryable = Pick<pg.Pool, "query">;

export async function withTransaction<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
