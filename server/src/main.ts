import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { serve } from "@hono/node-server";
import pg from "pg";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { migrate } from "./db/migrate.js";
import { createCohereEmbed } from "./embedding/cohere-on-bedrock.js";
import { log } from "./log.js";
import { startProcessor } from "./processing/process-items.js";

const config = readConfig();
await migrate(config.databaseUrl);

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const bedrock = new BedrockRuntimeClient({ region: config.awsRegion });
const embed = createCohereEmbed(bedrock, config.embeddingModelId);
const processor = startProcessor({ pool, embed });
const app = createApp({ pool, embed, processor, webDist: config.webDist });

const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) =>
  log("info", "listening", { url: `http://localhost:${port}` }),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    log("info", "shutting down", { signal });
    server.close();
    await processor.stop();
    await pool.end();
  });
}
