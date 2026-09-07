import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono, z } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import type { Db } from "./db/index.js";
import { apiKeyMiddleware } from "./middleware/api-key.js";
import { registerHealthRoute } from "./routes/health/get-health.js";
import { registerGetEnrichmentRoute } from "./routes/links/get-enrichment.js";
import { registerGetLinkRoute } from "./routes/links/get-link.js";
import { registerListLinksRoute } from "./routes/links/list-links.js";
import { registerSaveLinkRoute } from "./routes/links/save-link.js";

export interface AppOptions {
  apiKey?: string;
  corsOrigins?: string[];
}

export function createApp(db: Db, options: AppOptions = {}): OpenAPIHono {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: "invalid_request", details: z.flattenError(result.error) }, 400);
      }
    },
  });

  app.onError((err, c) => {
    console.error(
      JSON.stringify({
        msg: "unhandled error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json({ error: "internal_error" }, 500);
  });

  // Registered before the key check so browser preflights succeed without a key.
  if (options.corsOrigins?.length) {
    app.use(
      "*",
      cors({
        origin: options.corsOrigins,
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["content-type", "x-api-key", "idempotency-key"],
      }),
    );
  }

  // Health, /openapi.json, and /docs stay open: load balancer checks and the
  // demonstration surface need no key.
  if (options.apiKey) {
    app.use("/links", apiKeyMiddleware(options.apiKey));
    app.use("/links/*", apiKeyMiddleware(options.apiKey));
  }

  registerHealthRoute(app, db);
  registerSaveLinkRoute(app, db);
  registerListLinksRoute(app, db);
  registerGetLinkRoute(app, db);
  registerGetEnrichmentRoute(app, db);

  app.openAPIRegistry.registerComponent("securitySchemes", "ApiKey", {
    type: "apiKey",
    in: "header",
    name: "x-api-key",
    description: "Required on link routes when the deployment configures API_KEY.",
  });

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Revisit API",
      version: "0.1.0",
      description: "Save links, browse and filter them, and read each link's grounded enrichment.",
    },
  });

  app.get("/docs", swaggerUI({ url: "/openapi.json" }));

  return app;
}
