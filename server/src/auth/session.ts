import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import type { AuthSettings } from "./sign-in.js";

export const sessionCookie = "revisit_session";

export async function startSession(c: Context, userId: string, auth: AuthSettings): Promise<void> {
  setCookie(c, sessionCookie, await createSessionToken(userId, auth.sessionSecret), {
    path: "/",
    httpOnly: true,
    secure: auth.appUrl.protocol === "https:",
    sameSite: "Lax",
    maxAge: sessionSeconds,
  });
}

export function createSessionToken(userId: string, secret: string): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + sessionSeconds;
  return sign({ sub: userId, exp: expiresAt }, secret, "HS256");
}

export async function readSession(c: Context, secret: string): Promise<string | undefined> {
  const token = getCookie(c, sessionCookie);
  if (!token) return undefined;
  const payload = await verify(token, secret, "HS256").catch(() => undefined);
  return typeof payload?.sub === "string" ? payload.sub : undefined;
}

const sessionSeconds = 30 * 24 * 60 * 60;
