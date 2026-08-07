import pg from "pg";

export interface Db {
  ping(): Promise<void>;
}

export function createDb(databaseUrl: string): Db & { end(): Promise<void> } {
  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  // Idle clients emit 'error' when postgres drops a connection (e.g. restart);
  // without a listener that is an unhandled event and the process crashes.
  pool.on("error", (err) => {
    console.error(JSON.stringify({ msg: "pg pool error", error: err.message }));
  });
  return {
    async ping() {
      await pool.query("SELECT 1");
    },
    async end() {
      await pool.end();
    },
  };
}
