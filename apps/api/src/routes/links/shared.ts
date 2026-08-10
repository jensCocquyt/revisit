import { z } from "@hono/zod-openapi";
import type { LinkRow } from "../../db/index.js";

export const linkResponseSchema = z
  .object({
    id: z.uuid(),
    url: z.string(),
    note: z.string().nullable(),
    goal: z.string().nullable(),
    status: z.enum(["pending", "enriched", "failed"]),
    created_at: z.string(),
  })
  .openapi("Link");

export function toLinkResponse(link: LinkRow) {
  return {
    id: link.id,
    url: link.url,
    note: link.note,
    goal: link.goal,
    status: link.status,
    created_at: link.created_at,
  };
}
