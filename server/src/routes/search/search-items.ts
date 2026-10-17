import type { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../../app.js";
import type { SearchResults } from "../../contract.js";
import { searchItems } from "../../search/search-items.js";
import { validate } from "../shared/validate.js";

export function registerSearchRoute(app: Hono, deps: AppDeps): void {
  app.get("/api/search", validate("query", searchQuery), async (c) => {
    const { q, kind, from, to } = c.req.valid("query");
    const results = await searchItems(deps, q, { kind, from, to });
    return c.json<SearchResults>({ results });
  });
}

const searchQuery = z.object({
  q: z.string().trim().min(1).max(500),
  kind: z.enum(["text"]).optional(),
  from: z.iso.datetime({ offset: true }).pipe(z.coerce.date()).optional(),
  to: z.iso.datetime({ offset: true }).pipe(z.coerce.date()).optional(),
});
