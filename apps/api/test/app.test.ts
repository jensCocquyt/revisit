import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Db } from "../src/db.js";

const healthyDb: Db = {
  ping: async () => {},
};

const downDb: Db = {
  ping: async () => {
    throw new Error("connection refused");
  },
};

describe("GET /health", () => {
  it("returns 200 with ok statuses when the database is reachable", async () => {
    const app = createApp(healthyDb);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok" });
  });

  it("returns 503 when the database is unreachable", async () => {
    const app = createApp(downDb);
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded", db: "error" });
  });
});
