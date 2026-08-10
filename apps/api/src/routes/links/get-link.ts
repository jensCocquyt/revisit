import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Db } from "../../db/index.js";
import { jsonError } from "../shared/responses.js";
import { linkResponseSchema, toLinkResponse } from "./shared.js";

export function registerGetLinkRoute(app: OpenAPIHono, db: Db): void {
  app.openapi(getLinkRoute, async (c) => {
    const { id } = c.req.valid("param");
    const link = await db.getLink(id);
    if (!link) {
      return c.json({ error: "link_not_found" }, 404);
    }
    return c.json(toLinkResponse(link), 200);
  });
}

export const linkIdParamSchema = z.object({
  id: z.uuid().openapi({
    param: { name: "id", in: "path" },
    example: "0d9f6a1c-3b6e-4c2d-9f6a-1c3b6e4c2d9f",
  }),
});

const getLinkRoute = createRoute({
  method: "get",
  path: "/links/{id}",
  request: { params: linkIdParamSchema },
  responses: {
    200: {
      description: "Current stored representation of the link",
      content: { "application/json": { schema: linkResponseSchema } },
    },
    400: jsonError("Malformed link id"),
    404: jsonError("No link with this id"),
  },
});
