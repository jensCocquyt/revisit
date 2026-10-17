import { readFile } from "node:fs/promises";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import pg from "pg";
import { z } from "zod";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import type { Item, SearchResults } from "../src/contract.js";
import { findItem } from "../src/db/items.js";
import { migrate } from "../src/db/migrate.js";
import { createCohereEmbed } from "../src/embedding/cohere-on-bedrock.js";
import { processItem } from "../src/processing/process-items.js";

const hitDepth = 5;
const requiredHitRate = 0.9;

const databaseUrl = process.env.EVAL_DATABASE_URL;
if (!databaseUrl) throw new Error("EVAL_DATABASE_URL is not set; see .env.example");
const config = readConfig({ ...process.env, DATABASE_URL: databaseUrl });

await migrate(config.databaseUrl);
const pool = new pg.Pool({ connectionString: config.databaseUrl });
await pool.query("TRUNCATE items CASCADE");
const embed = createCohereEmbed(
  new BedrockRuntimeClient({ region: config.awsRegion }),
  config.embeddingModelId,
);
const app = createApp({ pool, embed, processor: { wake: () => {} } });

const corpus = z
  .array(
    z.object({
      key: z.string(),
      kind: z.literal("text"),
      text: z.string(),
      note: z.string().optional(),
    }),
  )
  .parse(await readJson("corpus.json"));
const queries = z
  .array(z.object({ query: z.string(), expected: z.string() }))
  .parse(await readJson("queries.json"));

const keyByItemId = new Map<string, string>();
for (const entry of corpus) {
  const { key, ...body } = entry;
  const response = await app.request("/api/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status !== 201) throw new Error(`saving ${key} failed: ${await response.text()}`);
  const saved = (await response.json()) as Item;
  const pending = await findItem(pool, saved.id);
  if (!pending) throw new Error(`${key} disappeared`);
  await processItem({ pool, embed }, pending);
  const processed = await findItem(pool, saved.id);
  if (processed?.status !== "ready") throw new Error(`${key} failed: ${processed?.error}`);
  keyByItemId.set(saved.id, key);
}

let hits = 0;
let reciprocalRankSum = 0;
for (const { query, expected } of queries) {
  const response = await app.request(`/api/search?${new URLSearchParams({ q: query })}`);
  const { results } = (await response.json()) as SearchResults;
  const index = results.findIndex((result) => keyByItemId.get(result.item.id) === expected);
  const rank = index + 1;
  if (rank >= 1 && rank <= hitDepth) hits++;
  if (rank >= 1) reciprocalRankSum += 1 / rank;
  const top = keyByItemId.get(results[0]?.item.id ?? "") ?? "nothing";
  const matchedBy = results[index]?.matchedBy.join("+") ?? "";
  console.log(
    `${rank >= 1 && rank <= hitDepth ? "hit " : "MISS"}  ${String(rank || "-").padStart(2)}  ${query.padEnd(48)} ${expected} ${matchedBy ? `(${matchedBy})` : ""}${rank === 1 ? "" : `  top: ${top}`}`,
  );
}

const requiredHits = Math.ceil(queries.length * requiredHitRate);
console.log(
  `\n${hits}/${queries.length} in top ${hitDepth} (need ${requiredHits}), mean reciprocal rank ${(reciprocalRankSum / queries.length).toFixed(3)}`,
);
process.exitCode = hits >= requiredHits ? 0 : 1;
await pool.end();

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(file, import.meta.url), "utf8"));
}
