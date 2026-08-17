import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Db } from "./db/index.js";
import { apiKeyMiddleware } from "./middleware/api-key.js";
import { registerHealthRoute } from "./routes/health/get-health.js";
import { registerGetLinkRoute } from "./routes/links/get-link.js";
import { registerSaveLinkRoute } from "./routes/links/save-link.js";

export interface AppOptions {
  apiKey?: string;
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

  // Health, /openapi.json, and /docs stay open: load balancer checks and the
  // demonstration surface need no key.
  if (options.apiKey) {
    app.use("/links", apiKeyMiddleware(options.apiKey));
    app.use("/links/*", apiKeyMiddleware(options.apiKey));
  }

  registerHealthRoute(app, db);
  registerSaveLinkRoute(app, db);
  registerGetLinkRoute(app, db);

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
      description: "Save a link, retrieve it, and queue its enrichment.",
    },
  });

  app.get("/docs", swaggerUI({ url: "/openapi.json" }));

  return app;
}
