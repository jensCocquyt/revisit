import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { Item, ItemDetail, ItemList } from "../src/contract.js";
import { findItem } from "../src/db/items.js";
import type { Embed } from "../src/embedding/embed.js";
import { processItem, startProcessor } from "../src/processing/process-items.js";
import { fakeEmbed } from "./fake-embed.js";
import { createTestPool, emptyDatabase } from "./test-database.js";

const pool = createTestPool();
const wake = vi.fn();
const app = createApp({ pool, embed: fakeEmbed, processor: { wake } });

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
    await processItem({ pool, embed: fakeEmbed }, await requireItem(saved.id));

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
    await processItem({ pool, embed: failingEmbed }, await requireItem(saved.id));
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

    const processor = startProcessor({ pool, embed: fakeEmbed });
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

describe("deleting", () => {
  it("removes the item and its passages", async () => {
    const saved = (await (await saveText("to delete")).json()) as Item;
    await processItem({ pool, embed: fakeEmbed }, await requireItem(saved.id));

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
