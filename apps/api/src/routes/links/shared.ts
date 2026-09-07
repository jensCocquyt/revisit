import { z } from "@hono/zod-openapi";
import { validateEnrichmentResult } from "../../contract.js";
import type { LinkRow } from "../../db/index.js";

export const linkResponseSchema = z
  .object({
    id: z.uuid(),
    url: z.string(),
    note: z.string().nullable(),
    goal: z.string().nullable(),
    status: z.enum(["pending", "enriched", "failed"]),
    created_at: z.string(),
    tags: z.array(z.string()).openapi({
      description: "Tags of the latest contract-valid enrichment; empty until enriched.",
    }),
    deadline: z.iso.date().nullable().openapi({
      description: "Deadline date of the latest contract-valid enrichment, or null.",
    }),
  })
  .openapi("Link");

export function toLinkResponse(link: LinkRow) {
  const facets = enrichmentFacets(link);
  return {
    id: link.id,
    url: link.url,
    note: link.note,
    goal: link.goal,
    status: link.status,
    created_at: link.created_at,
    tags: facets.tags,
    deadline: facets.deadline,
  };
}

export function logInvalidStoredResult(linkId: string, errors: string[]): void {
  console.error(JSON.stringify({ msg: "stored enrichment invalid", link_id: linkId, errors }));
}

// A stored result that fails the contract must not hide the link itself from
// listings, so it degrades to empty facets and a log line.
function enrichmentFacets(link: LinkRow): { tags: string[]; deadline: string | null } {
  if (link.latest_result === null || link.latest_result === undefined) {
    return { tags: [], deadline: null };
  }
  const validation = validateEnrichmentResult(link.latest_result);
  if (!validation.data) {
    logInvalidStoredResult(link.id, validation.errors);
    return { tags: [], deadline: null };
  }
  return { tags: validation.data.tags, deadline: validation.data.deadline?.date ?? null };
}
