import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Db } from "./db/index.js";
import { registerGetLinkRoute } from "./routes/get-link.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerSaveLinkRoute } from "./routes/save-link.js";

export function createApp(db: Db): OpenAPIHono {
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

  registerHealthRoute(app, db);
  registerSaveLinkRoute(app, db);
  registerGetLinkRoute(app, db);

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
