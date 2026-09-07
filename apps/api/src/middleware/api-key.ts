import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";

// Spend protection for the public demo deployment, not authentication.
export function apiKeyMiddleware(apiKey: string) {
  const expected = Buffer.from(apiKey);
  return async (c: Context, next: Next) => {
    const actual = Buffer.from(c.req.header("x-api-key") ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}
