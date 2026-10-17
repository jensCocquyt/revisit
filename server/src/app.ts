import { existsSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";
import type pg from "pg";
import type { ErrorResponse } from "./contract.js";
import type { Embed } from "./embedding/embed.js";
import { describeError, log } from "./log.js";
import type { Processor } from "./processing/process-items.js";
import { registerGetHealthRoute } from "./routes/health/get-health.js";
import { registerDeleteItemRoute } from "./routes/items/delete-item.js";
import { registerGetItemRoute } from "./routes/items/get-item.js";
import { registerListItemsRoute } from "./routes/items/list-items.js";
import { registerRetryItemRoute } from "./routes/items/retry-item.js";
import { registerSaveItemRoute } from "./routes/items/save-item.js";
import { registerSearchRoute } from "./routes/search/search-items.js";

export type AppDeps = {
  pool: pg.Pool;
  embed: Embed;
  processor: Pick<Processor, "wake">;
  webDist?: string;
};

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use(logRequests);
  registerGetHealthRoute(app, deps);
  registerSaveItemRoute(app, deps);
  registerListItemsRoute(app, deps);
  registerGetItemRoute(app, deps);
  registerRetryItemRoute(app, deps);
  registerDeleteItemRoute(app, deps);
  registerSearchRoute(app, deps);
  app.all("/api/*", (c) => c.json<ErrorResponse>({ error: "not found" }, 404));
  if (deps.webDist) serveWebApp(app, deps.webDist);
  app.onError((error, c) => {
    log("error", "request failed", { path: c.req.path, error: describeError(error) });
    return c.json<ErrorResponse>({ error: "internal error" }, 500);
  });
  return app;
}

function serveWebApp(app: Hono, webDist: string): void {
  if (!existsSync(webDist)) {
    log("warn", "web app not built, serving the API only", { webDist });
    return;
  }
  app.use("*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ root: webDist, path: "index.html" }));
}

const logRequests: MiddlewareHandler = async (c, next) => {
  const started = performance.now();
  await next();
  log("info", "request", {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms: Math.round(performance.now() - started),
  });
};
