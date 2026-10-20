import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { createPool } from "./db/connection.js";
import { migrate } from "./db/migrate.js";
import { createCohereEmbed } from "./embedding/cohere-on-bedrock.js";
import { readLink } from "./links/read-link.js";
import { log } from "./log.js";
import { startProcessor } from "./processing/process-items.js";
import { createScreenshotReader } from "./screenshots/read-screenshot.js";

const config = readConfig();
await migrate(config.databaseUrl);

const pool = createPool(config.databaseUrl);
const bedrock = new BedrockRuntimeClient({ region: config.awsRegion });
const embed = createCohereEmbed(bedrock, config.embeddingModelId);
const readScreenshot = createScreenshotReader(
  new AnthropicBedrock({ awsRegion: config.awsRegion }),
  config.screenshotModelId,
);
const processor = startProcessor({
  pool,
  embed,
  readLink: (url) => readLink(url),
  readScreenshot,
});
const app = createApp({ pool, embed, processor, webDist: config.webDist });

const server = serve(
  { fetch: app.fetch, port: config.port, hostname: config.listenHost },
  ({ address, port }) => log("info", "listening", { url: `http://${address}:${port}` }),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    log("info", "shutting down", { signal });
    server.close();
    await processor.stop();
    await pool.end();
  });
}
