import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { Item, ItemDetail, ItemList } from "../src/contract.js";
import { findItem } from "../src/db/items.js";
import type { Embed } from "../src/embedding/embed.js";
import type { ReadLink } from "../src/links/read-link.js";
import { processItem, startProcessor } from "../src/processing/process-items.js";
import type { ReadScreenshot } from "../src/screenshots/read-screenshot.js";
import { fakeEmbed } from "./fake-embed.js";
import { createTestPool, emptyDatabase } from "./test-database.js";

const pool = createTestPool();
const wake = vi.fn();
const app = createApp({ pool, embed: fakeEmbed, processor: { wake } });
const unreachableLink: ReadLink = async () => {
  throw new Error("no link reading in this test");
};
const unreachableScreenshot: ReadScreenshot = async () => {
  throw new Error("no screenshot reading in this test");
};
const processing = {
  pool,
  embed: fakeEmbed,
  readLink: unreachableLink,
  readScreenshot: unreachableScreenshot,
};

beforeEach(async () => {
  await emptyDatabase(pool);
  wake.mockClear();
});

afterAll(async () => {
  await pool.end();
});

describe("saving text", () => {
  it("stores it as pending, titled by its first line, and wakes the processor", async () => {
    const response = await saveText("Leek soup\nWith potatoes and cream.", "for winter");
    expect(response.status).toBe(201);
    const item = (await response.json()) as Item;
    expect(item).toMatchObject({
      kind: "text",
      title: "Leek soup",
      note: "for winter",
      status: "pending",
    });
    expect(wake).toHaveBeenCalledOnce();
  });

  it("shortens a long first line for the title", async () => {
    const item = (await (await saveText(`${"a".repeat(200)}\nrest`)).json()) as Item;
    expect(item.title).toHaveLength(120);
    expect(item.title?.endsWith("…")).toBe(true);
  });

  it("rejects empty text and unknown kinds", async () => {
    expect((await saveText("   ")).status).toBe(400);
    const unknownKind = await post("/api/items", { kind: "video", text: "x" });
    expect(unknownKind.status).toBe(400);
    expect(await unknownKind.json()).toHaveProperty("error");
  });
});

describe("reading items", () => {
  it("lists newest first and returns the body of one item", async () => {
    const first = (await (await saveText("first")).json()) as Item;
    const second = (await (await saveText("second")).json()) as Item;
    const list = (await (await app.request("/api/items")).json()) as ItemList;
    expect(list.items.map((item) => item.id)).toEqual([second.id, first.id]);

    const detail = (await (await app.request(`/api/items/${first.id}`)).json()) as ItemDetail;
    expect(detail.body).toBe("first");
  });

  it("filters the list by kind and saved date in the database", async () => {
    const old = (await (await saveText("old note")).json()) as Item;
    const recent = (await (await saveText("recent note")).json()) as Item;
    await pool.query("UPDATE items SET created_at = now() - interval '400 days' WHERE id = $1", [
      old.id,
    ]);
    const lastYear = new Date(Date.now() - 365 * 86_400_000).toISOString();

    const sinceLastYear = await listIds({ from: lastYear });
    expect(sinceLastYear).toEqual([recent.id]);
    expect(await listIds({ to: lastYear })).toEqual([old.id]);
    expect(await listIds({ kind: "text" })).toHaveLength(2);
    expect((await app.request("/api/items?kind=video")).status).toBe(400);
  });

  it("answers 404 for an unknown id and 400 for a malformed one", async () => {
    expect((await app.request(`/api/items/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await app.request("/api/items/not-an-id")).status).toBe(400);
  });
});

describe("processing", () => {
  it("embeds a header passage and the body, then marks the item ready", async () => {
    const saved = (await (await saveText("Leek soup\nWith potatoes.", "winter")).json()) as Item;
    await processItem(processing, await requireItem(saved.id));

    expect(await findItem(pool, saved.id)).toMatchObject({ status: "ready", error: null });
    const { rows } = await pool.query(
      "SELECT text FROM passages WHERE item_id = $1 ORDER BY position",
      [saved.id],
    );
    expect(rows.map((row) => row.text)).toEqual(["Leek soup\nwinter", "Leek soup\nWith potatoes."]);
  });

  it("marks the item failed with the reason, and retry puts it back in the queue", async () => {
    const saved = (await (await saveText("anything")).json()) as Item;
    const failingEmbed: Embed = async () => {
      throw new Error("throttled");
    };
    await processItem({ ...processing, embed: failingEmbed }, await requireItem(saved.id));
    expect(await findItem(pool, saved.id)).toMatchObject({ status: "failed", error: "throttled" });

    const retry = await app.request(`/api/items/${saved.id}/retry`, { method: "POST" });
    expect(retry.status).toBe(202);
    expect(await retry.json()).toMatchObject({ status: "pending", error: null });
    expect(wake).toHaveBeenCalledTimes(2);

    const again = await app.request(`/api/items/${saved.id}/retry`, { method: "POST" });
    expect(again.status).toBe(409);
  });

  it("processes waiting items in the background and recovers ones left in flight", async () => {
    const waiting = (await (await saveText("waiting")).json()) as Item;
    const interrupted = (await (await saveText("interrupted")).json()) as Item;
    await pool.query("UPDATE items SET status = 'processing' WHERE id = $1", [interrupted.id]);

    const processor = startProcessor(processing);
    try {
      await vi.waitFor(
        async () => {
          expect((await findItem(pool, waiting.id))?.status).toBe("ready");
          expect((await findItem(pool, interrupted.id))?.status).toBe("ready");
        },
        { timeout: 5000, interval: 50 },
      );
    } finally {
      await processor.stop();
    }
  });
});

describe("links", () => {
  it("saves the address without tracking parameters and finds it again instead of duplicating", async () => {
    const first = await saveLink("https://Example.org/post?id=7&utm_source=mail#comments");
    expect(first.status).toBe(201);
    const saved = (await first.json()) as Item;
    expect(saved).toMatchObject({
      kind: "link",
      url: "https://example.org/post?id=7",
      title: null,
    });

    const again = await saveLink("https://example.org/post?id=7&utm_campaign=x");
    expect(again.status).toBe(200);
    expect(((await again.json()) as Item).id).toBe(saved.id);
  });

  it("keeps one item when the same address is saved twice at once", async () => {
    const responses = await Promise.all([
      saveLink("https://example.org/same"),
      saveLink("https://example.org/same"),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const [first, second] = (await Promise.all(responses.map((r) => r.json()))) as Item[];
    expect(first?.id).toBe(second?.id);
    const { rows } = await pool.query("SELECT 1 FROM items WHERE url = $1", [
      "https://example.org/same",
    ]);
    expect(rows).toHaveLength(1);
  });

  it("rejects addresses that are not http or https", async () => {
    expect((await saveLink("ftp://example.org/file")).status).toBe(400);
    expect((await saveLink("not a url")).status).toBe(400);
  });

  it("stores the page title and text when the page can be read", async () => {
    const saved = (await (await saveLink("https://example.org/soup", "dinner")).json()) as Item;
    const readLink: ReadLink = async () => ({ title: "Leek soup", body: "Leeks.", error: null });
    await processItem({ ...processing, readLink }, await requireItem(saved.id));

    expect(await findItem(pool, saved.id)).toMatchObject({
      status: "ready",
      title: "Leek soup",
      body: "Leeks.",
      error: null,
    });
    const { rows } = await pool.query(
      "SELECT text FROM passages WHERE item_id = $1 ORDER BY position",
      [saved.id],
    );
    expect(rows.map((row) => row.text)).toEqual([
      "Leek soup\ndinner\nhttps://example.org/soup",
      "Leeks.",
    ]);
  });

  it("keeps an unreadable page findable by address and note, and lets it be retried", async () => {
    const saved = (await (await saveLink("https://example.org/gone", "dinner")).json()) as Item;
    const readLink: ReadLink = async () => ({
      title: null,
      body: null,
      error: "the site answered 404",
    });
    await processItem({ ...processing, readLink }, await requireItem(saved.id));

    expect(await findItem(pool, saved.id)).toMatchObject({
      status: "ready",
      error: "the site answered 404",
    });
    const retry = await app.request(`/api/items/${saved.id}/retry`, { method: "POST" });
    expect(retry.status).toBe(202);
  });
});

describe("screenshots", () => {
  it("stores the image, serves it back, and reads it during processing", async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer();
    const response = await uploadScreenshot(png, "red square");
    expect(response.status).toBe(201);
    const saved = (await response.json()) as Item;
    expect(saved).toMatchObject({ kind: "screenshot", title: null, note: "red square" });

    const image = await app.request(`/api/items/${saved.id}/image`);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer()).equals(png)).toBe(true);

    const readScreenshot: ReadScreenshot = async (stored) => {
      expect(stored.mediaType).toBe("image/png");
      return { title: "Red square", body: "A red square.", error: null };
    };
    await processItem({ ...processing, readScreenshot }, await requireItem(saved.id));
    expect(await findItem(pool, saved.id)).toMatchObject({
      status: "ready",
      title: "Red square",
      body: "A red square.",
    });
  });

  it("rejects files that are not images, whatever they claim to be", async () => {
    const response = await uploadScreenshot(Buffer.from("<script>alert(1)</script>"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "not a PNG, JPEG, WebP or GIF image" });
  });

  it("rejects uploads over 10 MB", async () => {
    const response = await uploadScreenshot(Buffer.alloc(11 * 1024 * 1024));
    expect(response.status).toBe(413);
  });

  it("answers 404 for an item without an image", async () => {
    const saved = (await (await saveText("no image")).json()) as Item;
    expect((await app.request(`/api/items/${saved.id}/image`)).status).toBe(404);
  });
});

describe("deleting", () => {
  it("removes the item and its passages", async () => {
    const saved = (await (await saveText("to delete")).json()) as Item;
    await processItem(processing, await requireItem(saved.id));

    expect((await app.request(`/api/items/${saved.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await app.request(`/api/items/${saved.id}`)).status).toBe(404);
    const { rows } = await pool.query("SELECT 1 FROM passages WHERE item_id = $1", [saved.id]);
    expect(rows).toHaveLength(0);
    expect((await app.request(`/api/items/${saved.id}`, { method: "DELETE" })).status).toBe(404);
  });
});

async function listIds(filters: Record<string, string>): Promise<string[]> {
  const response = await app.request(`/api/items?${new URLSearchParams(filters)}`);
  return ((await response.json()) as ItemList).items.map((item) => item.id);
}

function saveText(text: string, note?: string) {
  return post("/api/items", { kind: "text", text, note });
}

function saveLink(url: string, note?: string) {
  return post("/api/items", { kind: "link", url, note });
}

function uploadScreenshot(bytes: Buffer, note?: string) {
  const form = new FormData();
  form.set("image", new File([new Uint8Array(bytes)], "screenshot.png", { type: "image/png" }));
  if (note) form.set("note", note);
  return app.request("/api/items", { method: "POST", body: form });
}

function post(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function requireItem(id: string): Promise<ItemDetail> {
  const item = await findItem(pool, id);
  if (!item) throw new Error(`item ${id} missing`);
  return item;
}
