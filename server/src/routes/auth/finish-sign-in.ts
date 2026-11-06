import type { Hono } from "hono";
import type { AppDeps, AppEnv } from "../../app.js";
import { startSession } from "../../auth/session.js";
import { callbackPath, loginPath, type SignedInAccount } from "../../auth/sign-in.js";
import { signInUser } from "../../db/users.js";
import { describeError, log } from "../../log.js";
import { takeSignInChecks } from "./shared.js";

// Failures answer with a page, never a redirect: Google signs straight back in, so it would loop.
export function registerFinishSignInRoute(app: Hono<AppEnv>, deps: AppDeps): void {
  app.get(callbackPath, async (c) => {
    const checks = await takeSignInChecks(c, deps.auth);
    if (!checks) return c.html(tryAgain("This sign-in expired or was not started here."), 400);
    const { search } = new URL(c.req.url);
    let account: SignedInAccount;
    try {
      account = await deps.auth.signIn.finish(
        new URL(`${callbackPath}${search}`, deps.auth.appUrl),
        checks,
      );
    } catch (error) {
      log("warn", "sign-in failed", { error: describeError(error) });
      return c.html(tryAgain("Google did not confirm the sign-in."), 400);
    }
    if (!account.emailVerified || !sameEmail(account.email, deps.auth.ownerEmail)) {
      log("warn", "sign-in refused", { emailVerified: account.emailVerified });
      return c.text("This account may not sign in.", 403);
    }
    await startSession(c, await signInUser(deps.pool, account), deps.auth);
    return c.redirect("/");
  });
}

function sameEmail(first: string, second: string): boolean {
  return first.toLowerCase() === second.toLowerCase();
}

function tryAgain(reason: string): string {
  return `<!doctype html><title>Revisit</title><p>${reason} <a href="${loginPath}">Sign in again</a>.</p>`;
}
