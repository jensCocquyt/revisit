import type { Hono } from "hono";
import type { AppDeps } from "../../app.js";

export function registerGetHealthRoute(app: Hono, deps: AppDeps): void {
  app.get("/api/health", async (c) => {
    await deps.pool.query("SELECT 1");
    return c.json({ status: "ok" });
  });
}
