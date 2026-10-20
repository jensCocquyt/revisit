import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { createPool } from "../src/db/connection.js";
import { testDatabaseUrl } from "./test-database.js";

describe("createPool", () => {
  it("keeps working after the database drops an idle connection", async () => {
    const pool = createPool(testDatabaseUrl());
    try {
      const { rows } = await pool.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const admin = new pg.Client({ connectionString: testDatabaseUrl() });
      await admin.connect();
      await admin.query("SELECT pg_terminate_backend($1)", [rows[0]?.pid]);
      await admin.end();
      await vi.waitFor(() => expect(pool.totalCount).toBe(0));

      const again = await pool.query<{ one: number }>("SELECT 1 AS one");
      expect(again.rows[0]?.one).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
