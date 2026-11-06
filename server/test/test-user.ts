import type pg from "pg";
import { createSessionToken, sessionCookie } from "../src/auth/session.js";
import type { AuthSettings, SignIn } from "../src/auth/sign-in.js";
import { signInUser } from "../src/db/users.js";

export type TestUser = { id: string; cookie: string };

const noGoogle: SignIn = {
  start: async () => {
    throw new Error("no Google sign-in in this test");
  },
  finish: async () => {
    throw new Error("no Google sign-in in this test");
  },
};

export const testAuth: AuthSettings = {
  signIn: noGoogle,
  ownerEmail: "owner@example.com",
  sessionSecret: "a test secret that is long enough to sign with",
  appUrl: new URL("http://localhost"),
};

export async function createTestUser(pool: pg.Pool, name = "owner"): Promise<TestUser> {
  const id = await signInUser(pool, {
    issuer: "https://accounts.example.com",
    subject: name,
    email: `${name}@example.com`,
  });
  return { id, cookie: `${sessionCookie}=${await createSessionToken(id, testAuth.sessionSecret)}` };
}

export function withSession(user: TestUser, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("cookie", user.cookie);
  return { ...init, headers };
}
