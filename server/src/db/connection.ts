import type pg from "pg";

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

export function onlyRow<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined || rows.length > 1) {
    throw new Error(`expected exactly one row, got ${rows.length}`);
  }
  return row;
}
