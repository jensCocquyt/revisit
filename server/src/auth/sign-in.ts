import type { Account } from "../db/users.js";

export const loginPath = "/auth/login";
export const callbackPath = "/auth/callback";

export type SignIn = {
  start(redirectUri: URL): Promise<{ url: URL; checks: SignInChecks }>;
  finish(callbackUrl: URL, checks: SignInChecks): Promise<SignedInAccount>;
};

export type SignInChecks = { state: string; nonce: string; codeVerifier: string };

export type SignedInAccount = Account & { emailVerified: boolean };

export type AuthSettings = {
  signIn: SignIn;
  ownerEmail: string;
  sessionSecret: string;
  appUrl: URL;
};
