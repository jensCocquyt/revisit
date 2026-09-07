import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  type EnrichmentResult,
  type EvidenceItem,
  enrichmentResultSchema,
  validateEnrichmentResult,
} from "../../contract.js";
import type { Db } from "../../db/index.js";
import { jsonError } from "../shared/responses.js";
import { linkIdParamSchema } from "./get-link.js";
import { logInvalidStoredResult } from "./shared.js";

export function registerGetEnrichmentRoute(app: OpenAPIHono, db: Db): void {
  app.openapi(getEnrichmentRoute, async (c) => {
    const { id } = c.req.valid("param");
    const link = await db.getLink(id);
    if (!link) {
      return c.json({ error: "link_not_found" }, 404);
    }
    const stored = await db.getEnrichment(id);
    if (!stored) {
      return c.json({ error: "enrichment_not_found" }, 404);
    }
    const validation = validateEnrichmentResult(stored.result);
    if (!validation.data) {
      logInvalidStoredResult(id, validation.errors);
      return c.json({ error: "enrichment_invalid" }, 500);
    }
    return c.json(
      {
        link_id: stored.link_id,
        created_at: stored.created_at,
        model_id: stored.model_id,
        prompt_version: stored.prompt_version,
        result: resolveEvidence(validation.data, stored.extracted_text, id),
      },
      200,
    );
  });
}

// Evidence is shown only when its quote is verbatim in the stored extracted
// text; anything else is dropped, never relocated. Offsets stay as the worker
// stored them (code points into that text).
function resolveEvidence(
  result: EnrichmentResult,
  extractedText: string | null,
  linkId: string,
): EnrichmentResult {
  const resolves = (item: EvidenceItem) => extractedText?.includes(item.quote) ?? false;
  const evidence = result.evidence.filter(resolves);
  const deadline = result.deadline && resolves(result.deadline.source) ? result.deadline : null;

  const evidenceDropped = result.evidence.length - evidence.length;
  const deadlineDropped = Boolean(result.deadline) && deadline === null;
  if (evidenceDropped > 0 || deadlineDropped) {
    console.error(
      JSON.stringify({
        msg: "unresolvable evidence dropped",
        link_id: linkId,
        evidence_dropped: evidenceDropped,
        deadline_dropped: deadlineDropped,
      }),
    );
  }
  return { ...result, evidence, deadline };
}

const enrichmentResponseSchema = z
  .object({
    link_id: z.uuid(),
    created_at: z.string(),
    model_id: z.string().nullable(),
    prompt_version: z.string(),
    result: enrichmentResultSchema.openapi("EnrichmentResult"),
  })
  .openapi("Enrichment");

const getEnrichmentRoute = createRoute({
  method: "get",
  path: "/links/{id}/enrichment",
  security: [{ ApiKey: [] }],
  request: { params: linkIdParamSchema },
  responses: {
    200: {
      description:
        "Latest stored enrichment, contract-validated; evidence items and a deadline whose source quote is not verbatim in the stored extracted text are dropped. `deadline` is null when absent.",
      content: { "application/json": { schema: enrichmentResponseSchema } },
    },
    400: jsonError("Malformed link id"),
    401: jsonError("Missing or wrong x-api-key while the deployment configures one"),
    404: jsonError(
      "No link with this id (link_not_found), or not enriched yet (enrichment_not_found)",
    ),
    500: jsonError("The stored result violates the contract (enrichment_invalid)"),
  },
});
