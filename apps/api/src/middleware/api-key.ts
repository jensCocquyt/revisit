import type { Context, Next } from "hono";

// Spend protection for the public demo deployment, not authentication.
export function apiKeyMiddleware(apiKey: string) {
  return async (c: Context, next: Next) => {
    if (c.req.header("x-api-key") !== apiKey) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}
