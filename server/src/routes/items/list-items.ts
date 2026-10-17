import type { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../../app.js";
import type { ItemList } from "../../contract.js";
import { listRecentItems } from "../../db/items.js";
import { validate } from "../shared/validate.js";

export function registerListItemsRoute(app: Hono, deps: AppDeps): void {
  app.get("/api/items", validate("query", listItemsQuery), async (c) => {
    const { limit } = c.req.valid("query");
    return c.json<ItemList>({ items: await listRecentItems(deps.pool, limit) });
  });
}

const listItemsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
