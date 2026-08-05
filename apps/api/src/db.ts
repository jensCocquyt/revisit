import pg from "pg";

export interface Db {
  ping(): Promise<void>;
}

export function createDb(databaseUrl: string): Db & { end(): Promise<void> } {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return {
    async ping() {
      await pool.query("SELECT 1");
    },
    async end() {
      await pool.end();
    },
  };
}
const unusedForCiCheck = 1;
