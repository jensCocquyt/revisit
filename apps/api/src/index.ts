import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDb } from "./db/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const port = Number(process.env.API_PORT ?? 3000);
const db = createDb(databaseUrl);
const app = createApp(db, { apiKey: process.env.API_KEY });

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(JSON.stringify({ msg: "api listening", port: info.port }));
});
