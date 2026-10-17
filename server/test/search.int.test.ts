import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { SearchResult, SearchResults } from "../src/contract.js";
import { findItem, insertItem } from "../src/db/items.js";
import { processItem } from "../src/processing/process-items.js";
import { fakeEmbed } from "./fake-embed.js";
import { createTestPool, emptyDatabase } from "./test-database.js";

const pool = createTestPool();
const app = createApp({ pool, embed: fakeEmbed, processor: { wake: () => {} } });

const texts = {
  error:
    "Postgres refused the connection\nError: connect ECONNREFUSED 127.0.0.1:5432 when starting the API",
  soup: "Leek soup\nLeek soup with potatoes and cream, ready in thirty minutes.",
  tax: "Belastingaangifte\nDe aangifte moet vóór 30 juni ingediend zijn.",
};
const ids: Record<keyof typeof texts, string> = { error: "", soup: "", tax: "" };

beforeAll(async () => {
  await emptyDatabase(pool);
  for (const [key, text] of Object.entries(texts) as [keyof typeof texts, string][]) {
    const item = await insertItem(pool, {
      kind: "text",
      url: null,
      title: text.split("\n")[0] ?? null,
      note: null,
      body: text,
    });
    const detail = await findItem(pool, item.id);
    if (!detail) throw new Error("item missing");
    await processItem(
      {
        pool,
        embed: fakeEmbed,
        readLink: async () => ({ title: null, body: null, error: null }),
        readScreenshot: async () => ({ title: null, body: null, error: null }),
      },
      detail,
    );
    ids[key] = item.id;
  }
});

afterAll(async () => {
  await pool.end();
});

describe("search", () => {
  it("finds whole words and highlights them", async () => {
    const [first] = await search("leek soup");
    expect(first?.item.id).toBe(ids.soup);
    expect(first?.matchedBy).toContain("words");
    expect(first?.snippet.filter((part) => part.highlight).map((part) => part.text)).toContain(
      "soup",
    );
  });

  it("finds a fragment of a longer token", async () => {
    const results = await search("ECONNREF");
    const match = results.find((result) => result.item.id === ids.error);
    expect(match?.matchedBy).toContain("fragment");
  });

  it("finds by meaning without shared whole words", async () => {
    const results = await search("leeks souping potato");
    const match = results.find((result) => result.item.id === ids.soup);
    expect(match?.matchedBy).toContain("meaning");
  });

  it("returns each item once", async () => {
    const results = await search("leek");
    const found = results.map((result) => result.item.id);
    expect(new Set(found).size).toBe(found.length);
  });

  it("applies kind and date filters", async () => {
    expect(await search("leek soup", { kind: "text" })).not.toHaveLength(0);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(await search("leek soup", { from: tomorrow })).toHaveLength(0);
    expect(await search("leek soup", { to: yesterday })).toHaveLength(0);
  });

  it("rejects an empty query and an unknown kind", async () => {
    expect((await app.request("/api/search?q=%20")).status).toBe(400);
    expect((await app.request("/api/search?q=soup&kind=video")).status).toBe(400);
  });
});

async function search(q: string, filters: Record<string, string> = {}): Promise<SearchResult[]> {
  const response = await app.request(`/api/search?${new URLSearchParams({ q, ...filters })}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as SearchResults).results;
}
