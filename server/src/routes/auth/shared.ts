import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { z } from "zod";
import type { AuthSettings, SignInChecks } from "../../auth/sign-in.js";

export async function keepSignInChecks(
  c: Context,
  checks: SignInChecks,
  auth: AuthSettings,
): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + checksSeconds;
  const token = await sign({ ...checks, exp: expiresAt }, auth.sessionSecret, "HS256");
  setCookie(c, checksCookie, token, {
    path: "/auth",
    httpOnly: true,
    secure: auth.appUrl.protocol === "https:",
    sameSite: "Lax",
    maxAge: checksSeconds,
  });
}

export async function takeSignInChecks(
  c: Context,
  auth: AuthSettings,
): Promise<SignInChecks | undefined> {
  const token = getCookie(c, checksCookie);
  if (!token) return undefined;
  deleteCookie(c, checksCookie, { path: "/auth" });
  const payload = await verify(token, auth.sessionSecret, "HS256").catch(() => undefined);
  const parsed = signInChecks.safeParse(payload);
  return parsed.success ? parsed.data : undefined;
}

const checksCookie = "revisit_sign_in";
const checksSeconds = 10 * 60;

const signInChecks = z.object({ state: z.string(), nonce: z.string(), codeVerifier: z.string() });
