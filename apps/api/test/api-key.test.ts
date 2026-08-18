import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { LinkRow } from "../src/db/index.js";
import { fakeDb } from "./fakes.js";

const KEY = "demo-secret";

const storedLink: LinkRow = {
  id: "0d9f6a1c-3b6e-4c2d-9f6a-1c3b6e4c2d9f",
  url: "https://example.com/article",
  note: null,
  goal: null,
  status: "pending",
  created_at: "2026-08-17T00:00:00.000Z",
};

const db = fakeDb({
  getLink: async () => storedLink,
  createLinkWithJob: async () => storedLink,
});

const saveRequest = (headers: Record<string, string>) =>
  new Request("http://local/links", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "k-1", ...headers },
    body: JSON.stringify({ url: "https://example.com/article" }),
  });

describe("API key protection when API_KEY is set", () => {
  const app = createApp(db, { apiKey: KEY });

  it("rejects link routes without a key and stores nothing", async () => {
    let created = false;
    const spyingApp = createApp(
      fakeDb({
        createLinkWithJob: async () => {
          created = true;
          return storedLink;
        },
      }),
      { apiKey: KEY },
    );
    const res = await spyingApp.request(saveRequest({}));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(created).toBe(false);
  });

  it("rejects a wrong key", async () => {
    const res = await app.request(`/links/${storedLink.id}`, {
      headers: { "x-api-key": "wrong" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("passes valid-key requests through unchanged, idempotency intact", async () => {
    const res = await app.request(saveRequest({ "x-api-key": KEY }));
    expect(res.status).toBe(201);

    const replayDb = fakeDb({
      findIdempotencyKey: async () => ({
        key: "k-1",
        // Hash of the same normalized request, so the replay path serves 200.
        requestHash: await requestHashOf(),
        linkId: storedLink.id,
      }),
      getLink: async () => storedLink,
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
