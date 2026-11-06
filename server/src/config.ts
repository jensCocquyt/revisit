import { z } from "zod";

export type Config = z.infer<typeof configSchema>;

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return configSchema.parse(env);
}

const configSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().positive().default(3000),
    // Google only redirects to plain http on localhost, so signing in works only on this machine.
    LISTEN_HOST: z.string().min(1).default("127.0.0.1"),
    AWS_REGION: z.string().min(1).default("eu-west-1"),
    EMBEDDING_MODEL_ID: z.string().min(1).default("cohere.embed-v4:0"),
    SCREENSHOT_MODEL_ID: z.string().min(1).default("eu.anthropic.claude-haiku-4-5-20251001-v1:0"),
    WEB_DIST: z.string().min(1).default("../web/dist"),
  })
  .transform((env) => ({
    databaseUrl: env.DATABASE_URL,
    port: env.PORT,
    listenHost: env.LISTEN_HOST,
    awsRegion: env.AWS_REGION,
    embeddingModelId: env.EMBEDDING_MODEL_ID,
    screenshotModelId: env.SCREENSHOT_MODEL_ID,
    webDist: env.WEB_DIST,
  }));

export type SignInConfig = z.infer<typeof signInConfigSchema>;

// Apart from readConfig so the eval and tests run without a Google client.
export function readSignInConfig(env: NodeJS.ProcessEnv = process.env): SignInConfig {
  return signInConfigSchema.parse(env);
}

const signInConfigSchema = z
  .object({
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    OWNER_EMAIL: z.email(),
    SESSION_SECRET: z.string().min(32),
    APP_URL: z.url().default("http://localhost:3000"),
  })
  .transform((env) => ({
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    ownerEmail: env.OWNER_EMAIL,
    sessionSecret: env.SESSION_SECRET,
    appUrl: new URL(env.APP_URL),
  }));
