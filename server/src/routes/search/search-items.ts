import type { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../../app.js";
import type { SearchResults } from "../../contract.js";
import { searchItems } from "../../search/search-items.js";
import { itemFilterQuery } from "../shared/item-filters.js";
import { validate } from "../shared/validate.js";

export function registerSearchRoute(app: Hono, deps: AppDeps): void {
  app.get("/api/search", validate("query", searchQuery), async (c) => {
    const { q, ...filters } = c.req.valid("query");
    const results = await searchItems(deps, q, filters);
    return c.json<SearchResults>({ results });
  });
}

const searchQuery = z.object({
  q: z.string().trim().min(1).max(500),
  ...itemFilterQuery,
});
