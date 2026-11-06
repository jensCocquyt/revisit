import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Item, ItemList, SearchResults } from "../src/contract.js";
import { findItem } from "../src/db/items.js";
import { processItem } from "../src/processing/process-items.js";
import { fakeEmbed } from "./fake-embed.js";
import { createTestPool, emptyDatabase } from "./test-database.js";
import { createTestUser, type TestUser, testAuth, withSession } from "./test-user.js";

const pool = createTestPool();
const app = createApp({ pool, embed: fakeEmbed, processor: { wake: () => {} }, auth: testAuth });
let first: TestUser;
let second: TestUser;

beforeEach(async () => {
  await emptyDatabase(pool);
  first = await createTestUser(pool, "first");
  second = await createTestUser(pool, "second");
});

afterAll(async () => {
  await pool.end();
});

describe("one user's items", () => {
  it("stay out of another user's list and search", async () => {
    const soup = await saveText(first, "Leek soup\nWith potatoes and cream.");
    const detail = await findItem(pool, first.id, soup.id);
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

    expect(await listIds(first)).toEqual([soup.id]);
    expect(await listIds(second)).toEqual([]);
    expect(await searchIds(first, "leek soup")).toEqual([soup.id]);
    expect(await searchIds(second, "leek soup")).toEqual([]);
  });

  it("cannot be opened, retried or deleted by another user", async () => {
    const note = await saveText(first, "private note");
    await pool.query("UPDATE items SET status = 'failed', error = 'throttled' WHERE id = $1", [
      note.id,
    ]);
    const path = `/api/items/${note.id}`;

    expect((await app.request(path, withSession(second))).status).toBe(404);
    const retry = await app.request(`${path}/retry`, withSession(second, { method: "POST" }));
    expect(retry.status).toBe(404);
    const removal = await app.request(path, withSession(second, { method: "DELETE" }));
    expect(removal.status).toBe(404);
    expect((await app.request(path, withSession(first))).status).toBe(200);
  });

  it("keep their screenshot from another user", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#000" } })
      .png()
      .toBuffer();
    const form = new FormData();
    form.set("image", new File([new Uint8Array(png)], "screenshot.png"));
    const upload = await app.request(
      "/api/items",
      withSession(first, { method: "POST", body: form }),
    );
    const screenshot = (await upload.json()) as Item;
    const path = `/api/items/${screenshot.id}/image`;

    expect((await app.request(path, withSession(second))).status).toBe(404);
    expect((await app.request(path, withSession(first))).status).toBe(200);
  });

  it("do not stop another user from saving the same link", async () => {
    const mine = await saveLink(first, "https://example.com/article");
    const theirs = await saveLink(second, "https://example.com/article");
    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(201);
    expect(((await theirs.json()) as Item).id).not.toBe(((await mine.json()) as Item).id);
    expect((await saveLink(second, "https://example.com/article")).status).toBe(200);
  });
});

async function saveText(user: TestUser, text: string): Promise<Item> {
  const response = await post(user, { kind: "text", text });
  return (await response.json()) as Item;
}

function saveLink(user: TestUser, url: string) {
  return post(user, { kind: "link", url });
}

function post(user: TestUser, body: unknown) {
  return app.request(
    "/api/items",
    withSession(user, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function listIds(user: TestUser): Promise<string[]> {
  const list = (await (await app.request("/api/items", withSession(user))).json()) as ItemList;
  return list.items.map((item) => item.id);
}

async function searchIds(user: TestUser, q: string): Promise<string[]> {
  const response = await app.request(
    `/api/search?${new URLSearchParams({ q })}`,
    withSession(user),
  );
  return ((await response.json()) as SearchResults).results.map((result) => result.item.id);
}
