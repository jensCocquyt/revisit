import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";
import type { ErrorResponse } from "../contract.js";
import { readSession } from "./session.js";
import { callbackPath, loginPath } from "./sign-in.js";

// Runs before anything that touches the database, so requests without a session cost nothing.
export function requireSession(sessionSecret: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.path === loginPath || c.req.path === callbackPath) return next();
    const userId = await readSession(c, sessionSecret);
    if (userId) {
      c.set("userId", userId);
      return next();
    }
    if (c.req.path.startsWith("/api/")) {
      return c.json<ErrorResponse>({ error: "sign in first" }, 401);
    }
    return c.redirect(loginPath);
  };
}
