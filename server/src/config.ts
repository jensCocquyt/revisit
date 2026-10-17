import { z } from "zod";

export type Config = z.infer<typeof configSchema>;

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return configSchema.parse(env);
}

const configSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().positive().default(3000),
    AWS_REGION: z.string().min(1).default("eu-west-1"),
    EMBEDDING_MODEL_ID: z.string().min(1).default("cohere.embed-v4:0"),
    WEB_DIST: z.string().min(1).default("../web/dist"),
  })
  .transform((env) => ({
    databaseUrl: env.DATABASE_URL,
    port: env.PORT,
    awsRegion: env.AWS_REGION,
    embeddingModelId: env.EMBEDDING_MODEL_ID,
    webDist: env.WEB_DIST,
  }));
