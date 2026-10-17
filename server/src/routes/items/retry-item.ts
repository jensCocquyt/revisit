import type { Hono } from "hono";
import type { AppDeps } from "../../app.js";
import type { ErrorResponse, Item } from "../../contract.js";
import { findItem, requeueItemWithError } from "../../db/items.js";
import { validate } from "../shared/validate.js";
import { itemIdParams, itemNotFound } from "./shared.js";

export function registerRetryItemRoute(app: Hono, deps: AppDeps): void {
  app.post("/api/items/:id/retry", validate("param", itemIdParams), async (c) => {
    const { id } = c.req.valid("param");
    const item = await requeueItemWithError(deps.pool, id);
    if (item) {
      deps.processor.wake();
      return c.json<Item>(item, 202);
    }
    return (await findItem(deps.pool, id))
      ? c.json<ErrorResponse>({ error: "only items with an error can be retried" }, 409)
      : c.json<ErrorResponse>(itemNotFound, 404);
  });
}
