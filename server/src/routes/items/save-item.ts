import type { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../../app.js";
import type { ErrorResponse, Item } from "../../contract.js";
import { findLinkItem, insertItem, type NewItem } from "../../db/items.js";
import { normalizeLinkUrl } from "../../links/normalize-url.js";
import { validate } from "../shared/validate.js";

export function registerSaveItemRoute(app: Hono, deps: AppDeps): void {
  app.post("/api/items", validate("json", saveItemBody), async (c) => {
    const body = c.req.valid("json");
    const note = body.note ?? null;
    let newItem: NewItem;
    if (body.kind === "link") {
      const url = normalizeLinkUrl(body.url);
      if (!url) return c.json<ErrorResponse>({ error: "not an http or https address" }, 400);
      newItem = { kind: "link", url, title: null, note, body: null };
    } else {
      newItem = { kind: "text", url: null, title: titleFromText(body.text), note, body: body.text };
    }
    const item = await insertItem(deps.pool, newItem);
    if (!item) {
      const existing = await findLinkItem(deps.pool, newItem.url ?? "");
      if (!existing) throw new Error("a saved link with this address vanished while saving");
      return c.json<Item>(existing, 200);
    }
    deps.processor.wake();
    return c.json<Item>(item, 201);
  });
}

const maxTitleLength = 120;

const optionalNote = z.string().trim().max(2000).optional();

const saveItemBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string().trim().min(1).max(200_000),
    note: optionalNote,
  }),
  z.object({
    kind: z.literal("link"),
    url: z.string().trim().min(1).max(2000),
    note: optionalNote,
  }),
]);

function titleFromText(text: string): string {
  const firstLine = text.split("\n", 1)[0]?.trim() ?? "";
  return firstLine.length > maxTitleLength
    ? `${firstLine.slice(0, maxTitleLength - 1).trimEnd()}…`
    : firstLine;
}
