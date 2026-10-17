import type { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../../app.js";
import type { Item } from "../../contract.js";
import { insertItem } from "../../db/items.js";
import { validate } from "../shared/validate.js";

export function registerSaveItemRoute(app: Hono, deps: AppDeps): void {
  app.post("/api/items", validate("json", saveItemBody), async (c) => {
    const body = c.req.valid("json");
    const item = await insertItem(deps.pool, {
      kind: "text",
      url: null,
      title: titleFromText(body.text),
      note: body.note ?? null,
      body: body.text,
    });
    deps.processor.wake();
    return c.json<Item>(item, 201);
  });
}

const maxTitleLength = 120;

const saveItemBody = z.object({
  kind: z.literal("text"),
  text: z.string().trim().min(1).max(200_000),
  note: z.string().trim().max(2000).optional(),
});

function titleFromText(text: string): string {
  const firstLine = text.split("\n", 1)[0]?.trim() ?? "";
  return firstLine.length > maxTitleLength
    ? `${firstLine.slice(0, maxTitleLength - 1).trimEnd()}…`
    : firstLine;
}
