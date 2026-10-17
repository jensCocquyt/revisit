import type { Hono } from "hono";
import type { AppDeps } from "../../app.js";
import type { ErrorResponse, ItemDetail } from "../../contract.js";
import { findItem } from "../../db/items.js";
import { validate } from "../shared/validate.js";
import { itemIdParams, itemNotFound } from "./shared.js";

export function registerGetItemRoute(app: Hono, deps: AppDeps): void {
  app.get("/api/items/:id", validate("param", itemIdParams), async (c) => {
    const item = await findItem(deps.pool, c.req.valid("param").id);
    return item ? c.json<ItemDetail>(item) : c.json<ErrorResponse>(itemNotFound, 404);
  });
}
