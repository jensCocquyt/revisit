import type pg from "pg";
import { createPool } from "../src/db/connection.js";

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set; see .env.example");
  return url;
}

export function createTestPool(): pg.Pool {
  return createPool(testDatabaseUrl());
}

export async function emptyDatabase(pool: pg.Pool): Promise<void> {
  await pool.query("TRUNCATE items CASCADE");
}
