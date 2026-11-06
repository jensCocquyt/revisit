import type { Hono } from "hono";
import type { AppDeps, AppEnv } from "../../app.js";
import { callbackPath, loginPath } from "../../auth/sign-in.js";
import { keepSignInChecks } from "./shared.js";

export function registerStartSignInRoute(app: Hono<AppEnv>, deps: AppDeps): void {
  app.get(loginPath, async (c) => {
    // The sign-in cookie must be set on the address Google sends the browser back to.
    if (new URL(c.req.url).origin !== deps.auth.appUrl.origin) {
      return c.redirect(new URL(loginPath, deps.auth.appUrl).href);
    }
    const { url, checks } = await deps.auth.signIn.start(new URL(callbackPath, deps.auth.appUrl));
    await keepSignInChecks(c, checks, deps.auth);
    return c.redirect(url.href);
  });
}
