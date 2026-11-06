import * as oidc from "openid-client";
import { z } from "zod";
import type { SignIn } from "./sign-in.js";

export async function createGoogleSignIn(clientId: string, clientSecret: string): Promise<SignIn> {
  const google = await oidc.discovery(
    new URL("https://accounts.google.com"),
    clientId,
    clientSecret,
  );
  return {
    start: async (redirectUri) => {
      const checks = {
        state: oidc.randomState(),
        nonce: oidc.randomNonce(),
        codeVerifier: oidc.randomPKCECodeVerifier(),
      };
      const url = oidc.buildAuthorizationUrl(google, {
        redirect_uri: redirectUri.href,
        scope: "openid email",
        state: checks.state,
        nonce: checks.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(checks.codeVerifier),
        code_challenge_method: "S256",
      });
      return { url, checks };
    },
    finish: async (callbackUrl, checks) => {
      const tokens = await oidc.authorizationCodeGrant(google, callbackUrl, {
        pkceCodeVerifier: checks.codeVerifier,
        expectedState: checks.state,
        expectedNonce: checks.nonce,
      });
      const claims = idTokenClaims.parse(tokens.claims());
      return {
        issuer: claims.iss,
        subject: claims.sub,
        email: claims.email,
        emailVerified: claims.email_verified,
      };
    },
  };
}

const idTokenClaims = z.object({
  iss: z.string(),
  sub: z.string(),
  email: z.string(),
  email_verified: z.boolean(),
});
