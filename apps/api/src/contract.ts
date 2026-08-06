import { z } from "zod";

export const CONTRACT_VERSION = "v1";

const evidenceItem = z.strictObject({
  quote: z.string().min(1).max(500),
  start_offset: z.number().int().min(0),
  end_offset: z.number().int().min(0),
});

const revisitSuggestion = z.strictObject({
  reason: z.string().min(1).max(500),
  suggested_date: z.iso.date(),
});

const baseShape = {
  contract_version: z.literal(CONTRACT_VERSION),
  summary: z.string().min(1).max(2000),
  key_takeaway: z.string().min(1).max(500),
  topics: z.array(z.string().min(1).max(100)).min(1).max(10),
  suggested_group: z.string().min(1).max(100),
  save_intent: z.enum(["reference", "read_later", "time_sensitive"]),
  evidence: z.array(evidenceItem).max(10),
};

// The revisit invariant is structural: only the `revisit` variant carries the
// revisit suggestion, and strict objects reject it everywhere else.
export const enrichmentResultSchema = z.discriminatedUnion("recommended_action", [
  z.strictObject({ ...baseShape, recommended_action: z.literal("none") }),
  z.strictObject({ ...baseShape, recommended_action: z.literal("read_soon") }),
  z.strictObject({ ...baseShape, recommended_action: z.literal("action") }),
  z.strictObject({
    ...baseShape,
    recommended_action: z.literal("revisit"),
    revisit: revisitSuggestion,
  }),
]);

export type EnrichmentResult = z.infer<typeof enrichmentResultSchema>;

export interface ContractValidation {
  valid: boolean;
  errors: string[];
  data?: EnrichmentResult;
}

/** Validate an enrichment result against the v1 contract. */
export function validateEnrichmentResult(result: unknown): ContractValidation {
  const parsed = enrichmentResultSchema.safeParse(result);
  if (parsed.success) {
    return { valid: true, errors: [], data: parsed.data };
  }
  const errors = parsed.error.issues.map((issue) => `/${issue.path.join("/")} ${issue.message}`);
  return { valid: false, errors };
}
