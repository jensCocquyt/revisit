import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, IdempotencyKeyConflictError, createDb } from "../src/db.js";
import {
  countRows,
  integrationDatabaseUrl,
  integrationPool,
  uniqueSubmission,
} from "./integration.js";

let db: (Db & { end(): Promise<void> }) | undefined;
let pool: pg.Pool;

beforeAll(() => {
  db = createDb(integrationDatabaseUrl());
  pool = integrationPool();
});

afterAll(async () => {
  await db?.end();
  await pool.end();
});

function submissionInput(scope: { url: string; key: string }) {
  return {
    url: scope.url,
    normalizedUrl: scope.url,
    note: "a note",
    goal: "a goal",
    idempotencyKey: scope.key,
    requestHash: "hash-of-request",
  };
}

describe("db.getLink", () => {
  it("returns null for an unknown id", async () => {
    expect(await db?.getLink(randomUUID())).toBeNull();
  });

  it("returns the stored link after creation", async () => {
    const scope = uniqueSubmission("db-getlink");
    const created = await db?.createLinkWithJob(submissionInput(scope));
    const fetched = await db?.getLink(created?.id ?? "");
    expect(fetched).toEqual(created);
  });
});

describe("db.findIdempotencyKey", () => {
  it("returns null for an unknown key", async () => {
    expect(await db?.findIdempotencyKey(`missing-${randomUUID()}`)).toBeNull();
  });

  it("returns the stored key record after creation", async () => {
    const scope = uniqueSubmission("db-findkey");
    const created = await db?.createLinkWithJob(submissionInput(scope));
    expect(await db?.findIdempotencyKey(scope.key)).toEqual({
      key: scope.key,
      requestHash: "hash-of-request",
      linkId: created?.id,
    });
  });
});

describe("db.createLinkWithJob", () => {
  it("commits link, job, and idempotency key together", async () => {
    const scope = uniqueSubmission("db-create");
    const before = Date.now();
    const link = await db?.createLinkWithJob(submissionInput(scope));

    expect(link).toMatchObject({
      url: scope.url,
      note: "a note",
      goal: "a goal",
      status: "pending",
    });

    expect(await countRows(pool, scope)).toEqual({ links: 1, jobs: 1, keys: 1 });

    const job = await pool.query(
      `SELECT j.status, j.attempts, j.available_at FROM enrichment_jobs j
       JOIN links l ON l.id = j.link_id WHERE l.url = $1`,
      [scope.url],
    );
    expect(job.rows[0].status).toBe("pending");
    expect(job.rows[0].attempts).toBe(0);
    // Claimable immediately: available_at is not in the future.
    expect(new Date(job.rows[0].available_at).getTime()).toBeLessThanOrEqual(before + 60_000);
  });

  it("throws IdempotencyKeyConflictError on a reused key and rolls back its link and job", async () => {
    const first = uniqueSubmission("db-conflict");
    await db?.createLinkWithJob(submissionInput(first));

    const second = { ...uniqueSubmission("db-conflict-second"), key: first.key };
    await expect(db?.createLinkWithJob(submissionInput(second))).rejects.toBeInstanceOf(
      IdempotencyKeyConflictError,
    );

    // The losing transaction left nothing behind.
    expect(await countRows(pool, second)).toEqual({ links: 0, jobs: 0, keys: 1 });
    expect(await countRows(pool, first)).toEqual({ links: 1, jobs: 1, keys: 1 });
  });
});
