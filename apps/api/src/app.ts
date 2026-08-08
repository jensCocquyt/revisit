import { Hono } from "hono";
import type { Db } from "./db.js";

export function createApp(db: Db): Hono {
  const app = new Hono();

  app.get("/health", async (c) => {
    try {
      await db.ping();
      return c.json({ status: "ok", db: "ok" });
    } catch {
      return c.json({ status: "degraded", db: "error" }, 503);
    }
  });

  return app;
}
