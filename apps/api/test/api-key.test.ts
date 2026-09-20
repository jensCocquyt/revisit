import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { fakeDb } from "./fakes.js";
import { storedEnrichment, storedLink } from "./results.js";

const KEY = "demo-secret";

const link = storedLink({ status: "pending" });

const db = fakeDb({
  getLink: async () => link,
  createLinkWithJob: async () => link,
  listLinks: async () => ({ items: [link], hasMore: false }),
  getEnrichment: async () => storedEnrichment(),
});

const saveRequest = (headers: Record<string, string>) =>
  new Request("http://local/links", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "k-1", ...headers },
    body: JSON.stringify({ url: "https://example.com/article" }),
  });

const readRoutes = ["/links", `/links/${link.id}`, `/links/${link.id}/enrichment`];

describe("API key protection when API_KEY is set", () => {
  const app = createApp(db, { apiKey: KEY });

  it("rejects link routes without a key and stores nothing", async () => {
    let created = false;
    const spyingApp = createApp(
      fakeDb({
        createLinkWithJob: async () => {
          created = true;
          return link;
        },
      }),
      { apiKey: KEY },
    );
    const res = await spyingApp.request(saveRequest({}));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(created).toBe(false);
  });

  it.each(readRoutes)("rejects %s without a key", async (path) => {
    const res = await app.request(path);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it.each(readRoutes)("rejects %s with a wrong key", async (path) => {
    const res = await app.request(path, { headers: { "x-api-key": "wrong" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it.each(readRoutes)("serves %s with the key", async (path) => {
    const res = await app.request(path, { headers: { "x-api-key": KEY } });
    expect(res.status).toBe(200);
  });

  it("passes valid-key requests through unchanged, idempotency intact", async () => {
    const res = await app.request(saveRequest({ "x-api-key": KEY }));
    expect(res.status).toBe(201);

    const replayDb = fakeDb({
      findIdempotencyKey: async () => ({
        key: "k-1",
        // Hash of the same normalized request, so the replay path serves 200.
        requestHash: await requestHashOf(),
        linkId: link.id,
      }),
      getLink: async () => link,
    });
    const replayApp = createApp(replayDb, { apiKey: KEY });
    const replay = await replayApp.request(saveRequest({ "x-api-key": KEY }));
    expect(replay.status).toBe(200);
  });

  it("leaves /health, /openapi.json, and /docs open", async () => {
    for (const path of ["/health", "/openapi.json", "/docs"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
    }
  });
});

describe("without API_KEY configured", () => {
  it("behaves exactly as before: no key required", async () => {
    const app = createApp(db);
    const res = await app.request(saveRequest({}));
    expect(res.status).toBe(201);
    for (const path of readRoutes) {
      expect((await app.request(path)).status, path).toBe(200);
    }
  });
});

async function requestHashOf(): Promise<string> {
  const { requestHash } = await import("../src/utils/request-hash.js");
  const { normalizeUrl } = await import("../src/utils/normalize-url.js");
  return requestHash({
    url: normalizeUrl("https://example.com/article"),
    note: null,
    goal: null,
  });
}
