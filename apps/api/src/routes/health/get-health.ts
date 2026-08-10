import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Db } from "../../db/index.js";

export function registerHealthRoute(app: OpenAPIHono, db: Db): void {
  app.openapi(healthRoute, async (c) => {
    try {
      await db.ping();
      return c.json({ status: "ok", db: "ok" }, 200);
    } catch {
      return c.json({ status: "degraded", db: "error" }, 503);
    }
  });
}

const healthResponseSchema = z
  .object({ status: z.string(), db: z.string() })
  .openapi("HealthStatus");

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      description: "API and database are reachable",
      content: { "application/json": { schema: healthResponseSchema } },
    },
    503: {
      description: "Database is unreachable",
      content: { "application/json": { schema: healthResponseSchema } },
    },
  },
});
