import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { TAG_MAX_LENGTH } from "../../contract.js";
import { CursorNotFoundError, type Db } from "../../db/index.js";
import { jsonError } from "../shared/responses.js";
import { linkResponseSchema, toLinkResponse } from "./shared.js";

export function registerListLinksRoute(app: OpenAPIHono, db: Db): void {
  app.openapi(listLinksRoute, async (c) => {
    const query = c.req.valid("query");
    let page: Awaited<ReturnType<Db["listLinks"]>>;
    try {
      page = await db.listLinks({
        status: query.status,
        tag: query.tag,
        limit: query.limit,
        afterId: query.cursor,
      });
    } catch (err) {
      if (err instanceof CursorNotFoundError) {
        return c.json({ error: "invalid_request" }, 400);
      }
      throw err;
    }
    const items = page.items.map(toLinkResponse);
    const last = items[items.length - 1];
    return c.json({ items, next_cursor: page.hasMore && last ? last.id : null }, 200);
  });
}

export const LIST_LIMIT_DEFAULT = 20;
export const LIST_LIMIT_MAX = 100;

export const listLinksQuerySchema = z.object({
  status: z.enum(["pending", "enriched", "failed"]).optional().openapi({
    description: "Only links in this status.",
  }),
  tag: z.string().trim().toLowerCase().min(1).max(TAG_MAX_LENGTH).optional().openapi({
    description: "Only links whose latest enrichment carries this tag (case-insensitive).",
    example: "python",
  }),
  limit: z.coerce.number().int().min(1).max(LIST_LIMIT_MAX).default(LIST_LIMIT_DEFAULT).openapi({
    description: "Page size, 1 to 100.",
  }),
  cursor: z.uuid().optional().openapi({
    description:
      "Opaque `next_cursor` from the previous page; one naming no stored link is rejected.",
  }),
});

const linkPageSchema = z
  .object({
    items: z.array(linkResponseSchema),
    next_cursor: z.string().nullable().openapi({
      description: "Pass as `cursor` to fetch the next page; null on the last page.",
    }),
  })
  .openapi("LinkPage");

const listLinksRoute = createRoute({
  method: "get",
  path: "/links",
  security: [{ ApiKey: [] }],
  request: { query: listLinksQuerySchema },
  responses: {
    200: {
      description: "Links newest first, filtered and keyset-paginated",
      content: { "application/json": { schema: linkPageSchema } },
    },
    400: jsonError("Invalid status, tag, or limit, or a cursor naming no stored link"),
    401: jsonError("Missing or wrong x-api-key while the deployment configures one"),
  },
});
