import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { fakeDb } from "./fakes.js";

const KEY = "demo-secret";
const UI = "http://localhost:5173";

describe("CORS", () => {
  it("emits no CORS headers when no origins are configured", async () => {
    const app = createApp(fakeDb(), { apiKey: KEY });
    const res = await app.request("/health", { headers: { Origin: UI } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers preflight for a listed origin without requiring the API key", async () => {
    const app = createApp(fakeDb(), { apiKey: KEY, corsOrigins: [UI] });
    const res = await app.request("/links", {
      method: "OPTIONS",
      headers: {
        Origin: UI,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "x-api-key, idempotency-key, content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(UI);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    const allowed = res.headers.get("access-control-allow-headers")?.toLowerCase() ?? "";
    for (const header of ["x-api-key", "idempotency-key", "content-type"]) {
      expect(allowed).toContain(header);
    }
  });

  it("echoes a listed origin on the actual request", async () => {
    const app = createApp(fakeDb(), { apiKey: KEY, corsOrigins: [UI] });
    const res = await app.request("/links", { headers: { Origin: UI, "x-api-key": KEY } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(UI);
  });

  it("still requires the key on the actual request", async () => {
    const app = createApp(fakeDb(), { apiKey: KEY, corsOrigins: [UI] });
    const res = await app.request("/links", { headers: { Origin: UI } });
    expect(res.status).toBe(401);
  });

  it("allows nothing for an unlisted origin", async () => {
    const app = createApp(fakeDb(), { apiKey: KEY, corsOrigins: [UI] });
    const res = await app.request("/links", {
      headers: { Origin: "https://evil.example", "x-api-key": KEY },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
