import type { Hono } from "hono";
import type { AppDeps } from "../../app.js";
import type { ErrorResponse } from "../../contract.js";
import { deleteItem } from "../../db/items.js";
import { validate } from "../shared/validate.js";
import { itemIdParams, itemNotFound } from "./shared.js";

export function registerDeleteItemRoute(app: Hono, deps: AppDeps): void {
  app.delete("/api/items/:id", validate("param", itemIdParams), async (c) => {
    const deleted = await deleteItem(deps.pool, c.req.valid("param").id);
    return deleted ? c.body(null, 204) : c.json<ErrorResponse>(itemNotFound, 404);
  });
}
