import type { Hono } from "hono";
import type { AppDeps, AppEnv } from "../../app.js";
import type { ErrorResponse, Item } from "../../contract.js";
import { findItem, requeueItemWithError } from "../../db/items.js";
import { validate } from "../shared/validate.js";
import { itemIdParams, itemNotFound } from "./shared.js";

export function registerRetryItemRoute(app: Hono<AppEnv>, deps: AppDeps): void {
  app.post("/api/items/:id/retry", validate("param", itemIdParams), async (c) => {
    const { id } = c.req.valid("param");
    const userId = c.get("userId");
    const item = await requeueItemWithError(deps.pool, userId, id);
    if (item) {
      deps.processor.wake();
      return c.json<Item>(item, 202);
    }
    return (await findItem(deps.pool, userId, id))
      ? c.json<ErrorResponse>({ error: "only items with an error can be retried" }, 409)
      : c.json<ErrorResponse>(itemNotFound, 404);
  });
}
