import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { EnrichmentResult } from "../src/contract.js";
import { type Db, createDb } from "../src/db/index.js";
import { integrationDatabaseUrl, integrationPool } from "./integration.js";
import { extractedText, validResult } from "./results.js";

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

// Other test files insert links concurrently, so every scenario scopes its
// rows with a unique tag and lists through that filter.
function uniqueTag(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}`;
}

async function createLink(label: string): Promise<string> {
  const id = randomUUID();
  const url = `https://example.com/${label}/${id}`;
  const result = await pool.query<{ id: string }>(
    "INSERT INTO links (url, normalized_url) VALUES ($1, $1) RETURNING id",
    [url],
  );
  return result.rows[0].id;
}

interface EnrichmentSeed {
  result?: unknown;
  createdAt?: string;
  text?: string | null;
  promptVersion?: string;
  modelId?: string;
}

async function enrich(linkId: string, seed: EnrichmentSeed = {}): Promise<void> {
  const contentHash = randomUUID();
  let contentVersionId: string | null = null;
  if (seed.text !== null) {
    const cv = await pool.query<{ id: string }>(
      `INSERT INTO content_versions (link_id, content_hash, extracted_text)
       VALUES ($1, $2, $3) RETURNING id`,
      [linkId, contentHash, seed.text ?? extractedText],
    );
    contentVersionId = cv.rows[0].id;
  }
  await pool.query(
    `INSERT INTO enrichments
       (link_id, content_version_id, content_hash, prompt_version, contract_version, result, model_id, created_at)
     VALUES ($1, $2, $3, $4, 'v2', $5::jsonb, $6, COALESCE($7::timestamptz, now()))`,
    [
      linkId,
      contentVersionId,
      contentHash,
      seed.promptVersion ?? "stub-v2",
      JSON.stringify(seed.result ?? validResult()),
      seed.modelId ?? "stub",
      seed.createdAt ?? null,
    ],
  );
  await pool.query("UPDATE links SET status = 'enriched' WHERE id = $1", [linkId]);
}

function tagged(tag: string, overrides: Partial<EnrichmentResult> = {}): EnrichmentResult {
  return validResult({ tags: [tag, "python"], ...overrides });
}

async function list(query: string) {
  const res = await app.request(`/links?${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    items: { id: string; created_at: string }[];
    next_cursor: string | null;
  };
}

describe("GET /links against PostgreSQL", () => {
  it("pages through a tagged library without gaps or repeats, newest first", async () => {
    const tag = uniqueTag("walk");
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      const id = await createLink("walk");
      await enrich(id, { result: tagged(tag) });
      ids.push(id);
    }

    const first = await list(`tag=${tag}&limit=10`);
    const second = await list(`tag=${tag}&limit=10&cursor=${first.next_cursor}`);
    const third = await list(`tag=${tag}&limit=10&cursor=${second.next_cursor}`);

    expect([first.items.length, second.items.length, third.items.length]).toEqual([10, 10, 5]);
    expect(third.next_cursor).toBeNull();

    const seen = [...first.items, ...second.items, ...third.items];
    expect(new Set(seen.map((item) => item.id)).size).toBe(25);
    expect(seen.map((item) => item.id).sort()).toEqual([...ids].sort());
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i - 1].created_at >= seen[i].created_at).toBe(true);
    }
  });

  it("does not shift the next page when a link is inserted mid-walk", async () => {
    const tag = uniqueTag("insert");
    for (let i = 0; i < 6; i++) {
      await enrich(await createLink("insert"), { result: tagged(tag) });
    }
    const all = await list(`tag=${tag}&limit=10`);
    const first = await list(`tag=${tag}&limit=3`);

    const newer = await createLink("insert");
    await enrich(newer, { result: tagged(tag) });

    const second = await list(`tag=${tag}&limit=3&cursor=${first.next_cursor}`);
    expect(second.items.map((item) => item.id)).toEqual(all.items.slice(3, 6).map((i) => i.id));
    expect(second.items.map((item) => item.id)).not.toContain(newer);
  });

  it("filters by status combined with tag", async () => {
    const tag = uniqueTag("status");
    const enriched = await createLink("status");
    await enrich(enriched, { result: tagged(tag) });
    const failed = await createLink("status");
    await enrich(failed, { result: tagged(tag) });
    await pool.query("UPDATE links SET status = 'failed' WHERE id = $1", [failed]);

    const page = await list(`tag=${tag}&status=enriched`);
    expect(page.items.map((item) => item.id)).toEqual([enriched]);
    expect((await list(`tag=${tag}&status=pending`)).items).toEqual([]);
  });

  it("matches tags case-insensitively and only on the latest enrichment", async () => {
    const tag = uniqueTag("latest");
    const superseded = await createLink("latest");
    await enrich(superseded, { result: tagged(tag), createdAt: "2026-01-01T00:00:00Z" });
    await enrich(superseded, { result: validResult({ tags: ["rust"] }) });

    const current = await createLink("latest");
    await enrich(current, { result: tagged(tag) });

    const page = await list(`tag=${tag.toUpperCase()}`);
    expect(page.items.map((item) => item.id)).toEqual([current]);
    expect(page.items[0]).toMatchObject({ tags: [tag, "python"], deadline: "2025-10-31" });
  });

  it("never matches a tag for links without an enrichment", async () => {
    const tag = uniqueTag("none");
    await createLink("none");
    expect(await list(`tag=${tag}`)).toEqual({ items: [], next_cursor: null });
  });
});

describe("GET /links/:id and /enrichment against PostgreSQL", () => {
  it("shows the newer enrichment's facets and serves it as the latest", async () => {
    const id = await createLink("facets");
    await enrich(id, {
      result: validResult({ tags: ["old"] }),
      createdAt: "2026-01-01T00:00:00Z",
      promptVersion: "stub-v1",
    });
    await enrich(id, { result: validResult({ tags: ["new"], deadline: null }), modelId: "m2" });

    const link = await (await app.request(`/links/${id}`)).json();
    expect(link).toMatchObject({ status: "enriched", tags: ["new"], deadline: null });

    const res = await app.request(`/links/${id}/enrichment`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ link_id: id, model_id: "m2", prompt_version: "stub-v2" });
    expect(body.result.tags).toEqual(["new"]);
    expect(body.result.deadline).toBeNull();
    expect(body.result.evidence).toEqual(validResult().evidence);
  });

  it("drops evidence that is not in the stored content version", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await createLink("drop");
    await enrich(id, { text: "A page that says none of the quoted sentences." });

    const body = await (await app.request(`/links/${id}/enrichment`)).json();
    expect(body.result.evidence).toEqual([]);
    expect(body.result.deadline).toBeNull();
    expect(body.result.summary).toBe(validResult().summary);
    vi.restoreAllMocks();
  });

  it("returns 404 enrichment_not_found for a pending link", async () => {
    const id = await createLink("pending");
    const res = await app.request(`/links/${id}/enrichment`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "enrichment_not_found" });
  });

  it("returns empty facets on a freshly saved link", async () => {
    const res = await app.request("/links", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": `facets-${randomUUID()}` },
      body: JSON.stringify({ url: `https://example.com/fresh/${randomUUID()}` }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ tags: [], deadline: null });
  });
});
