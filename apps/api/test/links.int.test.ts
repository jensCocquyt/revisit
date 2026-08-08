import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { type Db, createDb } from "../src/db.js";
import {
  countRows,
  integrationDatabaseUrl,
  integrationPool,
  uniqueSubmission,
} from "./integration.js";

let db: (Db & { end(): Promise<void> }) | undefined;
let pool: pg.Pool;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  db = createDb(integrationDatabaseUrl());
  pool = integrationPool();
  app = createApp(db as Db);
});

afterAll(async () => {
  await db?.end();
  await pool.end();
});

function post(body: unknown, key?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== undefined) {
    headers["Idempotency-Key"] = key;
  }
  return app.request("/links", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /links", () => {
  it("creates a link and exactly one enrichment job, returning 201", async () => {
    const scope = uniqueSubmission("post-create");
    const res = await post({ url: scope.url, note: "why", goal: "prep" }, scope.key);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ url: scope.url, note: "why", goal: "prep", status: "pending" });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.created_at).toBeTruthy();

    expect(await countRows(pool, scope)).toEqual({ links: 1, jobs: 1, keys: 1 });
  });

  it("replays an identical request with the same key as 200 without new rows", async () => {
    const scope = uniqueSubmission("post-replay");
    const first = await post({ url: scope.url, note: "n" }, scope.key);
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await post({ url: scope.url, note: "n" }, scope.key);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);

    expect(await countRows(pool, scope)).toEqual({ links: 1, jobs: 1, keys: 1 });
  });

  it("treats an omitted optional field and an equivalent normalized url as the same request", async () => {
    const scope = uniqueSubmission("post-normalized");
    const first = await post({ url: `${scope.url}#fragment` }, scope.key);
    expect(first.status).toBe(201);

    const replay = await post({ url: scope.url }, scope.key);
    expect(replay.status).toBe(200);
  });

  it("returns 409 when the key is reused with a different request", async () => {
    const scope = uniqueSubmission("post-conflict");
    expect((await post({ url: scope.url }, scope.key)).status).toBe(201);

    const other = uniqueSubmission("post-conflict-other");
    const res = await post({ url: other.url }, scope.key);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "idempotency_key_conflict" });
    expect(await countRows(pool, { url: other.url, key: scope.key })).toMatchObject({
      links: 0,
      jobs: 0,
    });
  });

  it.each([
    ["missing url", {}],
    ["non-http scheme", { url: "ftp://example.com/file" }],
    ["not a url", { url: "not a url" }],
    ["over-limit note", { url: "https://example.com/x", note: "n".repeat(2001) }],
    ["over-limit goal", { url: "https://example.com/x", goal: "g".repeat(201) }],
    ["unknown field", { url: "https://example.com/x", extra: true }],
  ])("rejects %s with 400 and creates no rows", async (_label, body) => {
    const scope = uniqueSubmission("post-invalid");
    const res = await post(body, scope.key);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
    expect(await countRows(pool, scope)).toEqual({ links: 0, jobs: 0, keys: 0 });
  });

  it("rejects a missing Idempotency-Key header with 400 and creates no rows", async () => {
    const scope = uniqueSubmission("post-nokey");
    const res = await post({ url: scope.url });
    expect(res.status).toBe(400);
    expect(await countRows(pool, scope)).toEqual({ links: 0, jobs: 0, keys: 0 });
  });

  it("rolls back atomically when the job insert fails mid-transaction", async () => {
    // A trigger forces the enrichment-job insert to fail for marked urls,
    // proving the link committed in the same transaction is rolled back.
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_force_job_insert_failure() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM links WHERE id = NEW.link_id AND url LIKE '%force-job-failure%'
        ) THEN
          RAISE EXCEPTION 'forced job insert failure (test)';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
    `);
    await pool.query("DROP TRIGGER IF EXISTS test_force_job_insert_failure ON enrichment_jobs");
    await pool.query(`
      CREATE TRIGGER test_force_job_insert_failure
      BEFORE INSERT ON enrichment_jobs
      FOR EACH ROW EXECUTE FUNCTION test_force_job_insert_failure();
    `);

    try {
      const scope = uniqueSubmission("force-job-failure");
      const res = await post({ url: scope.url }, scope.key);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal_error" });
      expect(await countRows(pool, scope)).toEqual({ links: 0, jobs: 0, keys: 0 });
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS test_force_job_insert_failure ON enrichment_jobs");
      await pool.query("DROP FUNCTION IF EXISTS test_force_job_insert_failure()");
    }
  });

  it("yields exactly one link when identical submissions race", async () => {
    const scope = uniqueSubmission("post-race");
    const body = { url: scope.url, note: "race" };
    const [a, b] = await Promise.all([post(body, scope.key), post(body, scope.key)]);

    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const [bodyA, bodyB] = await Promise.all([a.json(), b.json()]);
    expect(bodyA.id).toBe(bodyB.id);

    expect(await countRows(pool, scope)).toEqual({ links: 1, jobs: 1, keys: 1 });
  });
});

describe("GET /links/:id", () => {
  it("returns the stored representation", async () => {
    const scope = uniqueSubmission("get-link");
    const created = await (await post({ url: scope.url, goal: "g" }, scope.key)).json();

    const res = await app.request(`/links/${created.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: created.id,
      url: scope.url,
      note: null,
      goal: "g",
      status: "pending",
      created_at: created.created_at,
    });
  });

  it("returns 404 for an unknown id", async () => {
    const res = await app.request(`/links/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "link_not_found" });
  });

  it("returns 400 for a malformed id", async () => {
    const res = await app.request("/links/not-a-uuid");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
  });
});
