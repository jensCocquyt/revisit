import { sign } from "hono/jwt";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { sessionCookie } from "../src/auth/session.js";
import type { SignedInAccount, SignIn, SignInChecks } from "../src/auth/sign-in.js";
import type { ItemList } from "../src/contract.js";
import { fakeEmbed } from "./fake-embed.js";
import { createTestPool, emptyDatabase } from "./test-database.js";
import { createTestUser, testAuth, withSession } from "./test-user.js";

const pool = createTestPool();
const checks: SignInChecks = {
  state: "the-state",
  nonce: "the-nonce",
  codeVerifier: "the-verifier",
};
const owner: SignedInAccount = {
  issuer: "https://accounts.google.com",
  subject: "owner-subject",
  email: "owner@example.com",
  emailVerified: true,
};
let googleAnswer: SignedInAccount | Error;
const finishCalls: { callbackUrl: URL; checks: SignInChecks }[] = [];
const startCalls: URL[] = [];

const fakeGoogle: SignIn = {
  start: async (redirectUri) => {
    startCalls.push(redirectUri);
    return { url: new URL("https://accounts.example.com/authorize?client=revisit"), checks };
  },
  finish: async (callbackUrl, received) => {
    finishCalls.push({ callbackUrl, checks: received });
    if (googleAnswer instanceof Error) throw googleAnswer;
    return googleAnswer;
  },
};

const app = createApp({
  pool,
  embed: fakeEmbed,
  processor: { wake: () => {} },
  auth: { ...testAuth, signIn: fakeGoogle },
});

beforeEach(async () => {
  await emptyDatabase(pool);
  googleAnswer = owner;
  finishCalls.length = 0;
  startCalls.length = 0;
});

afterAll(async () => {
  await pool.end();
});

describe("without a session", () => {
  it("answers the API with 401 and sends pages to sign-in", async () => {
    expect((await app.request("/api/items")).status).toBe(401);
    expect((await app.request("/api/health")).status).toBe(401);
    const page = await app.request("/");
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/auth/login");
    expect((await app.request("/auth/anything-else")).status).toBe(302);
  });

  it("turns away a tampered, foreign or expired session", async () => {
    const user = await createTestUser(pool);
    const [, token = ""] = user.cookie.split("=");
    const tampered = `${token.slice(0, -2)}xx`;
    const foreign = await sign({ sub: user.id, exp: inSeconds(60) }, "another secret entirely");
    const expired = await sign({ sub: user.id, exp: inSeconds(-60) }, testAuth.sessionSecret);
    for (const bad of [tampered, foreign, expired]) {
      const response = await app.request("/api/items", {
        headers: { cookie: `${sessionCookie}=${bad}` },
      });
      expect(response.status).toBe(401);
    }
  });

  it("lets a valid session through", async () => {
    const user = await createTestUser(pool);
    expect((await app.request("/api/items", withSession(user))).status).toBe(200);
  });
});

describe("signing in", () => {
  it("sends the browser to Google with a callback on the app's own address", async () => {
    const response = await app.request("/auth/login");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://accounts.example.com/authorize?client=revisit",
    );
    expect(startCalls.map((url) => url.href)).toEqual(["http://localhost/auth/callback"]);
    expect(cookieFrom(response, "revisit_sign_in")).toBeDefined();
  });

  it("moves sign-in to the app's own address first", async () => {
    const response = await app.request("http://127.0.0.1:3000/auth/login");
    expect(response.headers.get("location")).toBe("http://localhost/auth/login");
    expect(startCalls).toHaveLength(0);
  });

  it("signs the owner in and remembers them across sign-ins", async () => {
    const first = await signInThroughGoogle("?code=first-code&state=the-state");
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe("/");
    expect(finishCalls[0]?.callbackUrl.href).toBe(
      "http://localhost/auth/callback?code=first-code&state=the-state",
    );
    expect(finishCalls[0]?.checks).toEqual(checks);

    const session = cookieFrom(first, sessionCookie);
    if (!session) throw new Error("no session cookie");
    const list = await app.request("/api/items", { headers: { cookie: session } });
    expect(list.status).toBe(200);

    await signInThroughGoogle();
    const { rows } = await pool.query("SELECT email FROM users");
    expect(rows).toEqual([{ email: "owner@example.com" }]);
  });

  it("matches the owner's email whatever its case", async () => {
    googleAnswer = { ...owner, email: "Owner@Example.com" };
    expect((await signInThroughGoogle()).status).toBe(302);
  });

  it("turns away another account and an unverified email", async () => {
    for (const refused of [
      { ...owner, subject: "stranger", email: "stranger@example.com" },
      { ...owner, emailVerified: false },
    ]) {
      googleAnswer = refused;
      const response = await signInThroughGoogle();
      expect(response.status).toBe(403);
      expect(cookieFrom(response, sessionCookie)).toBeUndefined();
    }
    const { rows } = await pool.query("SELECT 1 FROM users");
    expect(rows).toHaveLength(0);
  });

  it("answers a page, not a redirect, when the sign-in cannot finish", async () => {
    const withoutStart = await app.request("/auth/callback?code=x&state=the-state");
    expect(withoutStart.status).toBe(400);
    expect(finishCalls).toHaveLength(0);

    googleAnswer = new Error("state mismatch");
    const rejected = await signInThroughGoogle();
    expect(rejected.status).toBe(400);
    expect(await rejected.text()).toContain('href="/auth/login"');
  });

  it("gives the owner's first sign-in the items saved before sign-in existed", async () => {
    await pool.query("INSERT INTO items (kind, title, body) VALUES ('text', 'Old note', 'old')");
    const response = await signInThroughGoogle();
    const session = cookieFrom(response, sessionCookie) ?? "";
    const list = (await (
      await app.request("/api/items", { headers: { cookie: session } })
    ).json()) as ItemList;
    expect(list.items.map((item) => item.title)).toEqual(["Old note"]);
  });
});

async function signInThroughGoogle(search = "?code=a-code&state=the-state"): Promise<Response> {
  const login = await app.request("/auth/login");
  const started = cookieFrom(login, "revisit_sign_in");
  if (!started) throw new Error("no sign-in cookie");
  return app.request(`/auth/callback${search}`, { headers: { cookie: started } });
}

function cookieFrom(response: Response, name: string): string | undefined {
  return response.headers
    .getSetCookie()
    .map((header) => header.split(";", 1)[0] ?? "")
    .find((pair) => pair.startsWith(`${name}=`) && pair.length > name.length + 1);
}

function inSeconds(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}
