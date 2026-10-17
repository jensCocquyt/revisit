import type pg from "pg";
import type { ItemDetail } from "../contract.js";
import {
  claimNextPendingItem,
  completeItem,
  failItem,
  type ReadContent,
  resetInFlightItems,
} from "../db/items.js";
import type { Embed } from "../embedding/embed.js";
import type { ReadLink } from "../links/read-link.js";
import { describeError, log } from "../log.js";
import { splitIntoPassages } from "./split-into-passages.js";

export type ProcessingDeps = { pool: pg.Pool; embed: Embed; readLink: ReadLink };

export type Processor = { wake(): void; stop(): Promise<void> };

// Assumes a single server process: claiming takes no locks.
export function startProcessor(deps: ProcessingDeps): Processor {
  const wakeSignal = createWakeSignal();
  let stopped = false;
  let inFlightReset = false;
  const running = (async () => {
    while (!stopped) {
      try {
        if (!inFlightReset) {
          await resetInFlightItems(deps.pool);
          inFlightReset = true;
        }
        const item = await claimNextPendingItem(deps.pool);
        if (item) await processItem(deps, item);
        else await wakeSignal.wait(idlePollMs);
      } catch (error) {
        log("error", "processing loop failed", { error: describeError(error) });
        await wakeSignal.wait(idlePollMs);
      }
    }
  })();
  return {
    wake: wakeSignal.notify,
    stop: async () => {
      stopped = true;
      wakeSignal.notify();
      await running;
    },
  };
}

export async function processItem(deps: ProcessingDeps, item: ItemDetail): Promise<void> {
  try {
    const content = await readContent(deps, item);
    const texts = [headerPassage(item, content), ...splitIntoPassages(content.body ?? "")].filter(
      (text) => text.length > 0,
    );
    const embeddings = await deps.embed(texts, "document");
    if (embeddings.length !== texts.length) {
      throw new Error(`expected ${texts.length} embeddings, got ${embeddings.length}`);
    }
    await completeItem(
      deps.pool,
      item.id,
      content,
      texts.map((text, index) => ({ text, embedding: embeddings[index] ?? [] })),
    );
    log("info", "item processed", { itemId: item.id, passages: texts.length });
  } catch (error) {
    log("warn", "item failed", { itemId: item.id, error: describeError(error) });
    await failItem(deps.pool, item.id, describeError(error));
  }
}

const idlePollMs = 5000;

async function readContent(deps: ProcessingDeps, item: ItemDetail): Promise<ReadContent> {
  switch (item.kind) {
    case "link":
      return deps.readLink(item.url ?? "");
    case "text":
      return { title: item.title, body: item.body, error: null };
  }
}

function headerPassage(item: ItemDetail, content: ReadContent): string {
  return [content.title, item.note, item.url].filter(Boolean).join("\n");
}

function createWakeSignal() {
  let signalled = false;
  let release: (() => void) | undefined;
  return {
    notify: () => {
      signalled = true;
      release?.();
    },
    wait: async (timeoutMs: number) => {
      if (!signalled) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, timeoutMs);
          function done() {
            clearTimeout(timer);
            release = undefined;
            resolve();
          }
          release = done;
        });
      }
      signalled = false;
    },
  };
}
