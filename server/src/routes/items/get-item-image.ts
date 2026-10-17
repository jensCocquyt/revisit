import type { Hono } from "hono";
import type { AppDeps } from "../../app.js";
import type { ErrorResponse } from "../../contract.js";
import { findItemImage } from "../../db/items.js";
import { validate } from "../shared/validate.js";
import { itemIdParams } from "./shared.js";

export function registerGetItemImageRoute(app: Hono, deps: AppDeps): void {
  app.get("/api/items/:id/image", validate("param", itemIdParams), async (c) => {
    const image = await findItemImage(deps.pool, c.req.valid("param").id);
    if (!image) return c.json<ErrorResponse>({ error: "image not found" }, 404);
    return c.body(new Uint8Array(image.bytes), 200, {
      "content-type": image.mediaType,
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    });
  });
}
