import { z } from "zod";

export const CONTRACT_VERSION = "v1";

// Names mirror the worker's pydantic models in apps/worker/worker/contract.py:
// EvidenceItem, RevisitSuggestion, NonRevisitResult, RevisitResult, EnrichmentResult.
// Keep them in sync when the contract changes.

const evidenceItemSchema = z
  .strictObject({
    quote: z.string().min(1).max(500),
    start_offset: z.number().int().min(0),
    end_offset: z.number().int().min(0),
  })
  .refine((item) => item.end_offset >= item.start_offset, {
    message: "end_offset must be >= start_offset",
    path: ["end_offset"],
  });

const revisitSuggestionSchema = z.strictObject({
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
  evidence: z.array(evidenceItemSchema).max(10),
};

const nonRevisitResultSchema = z.strictObject({
  ...baseShape,
  recommended_action: z.enum(["none", "read_soon", "action"]),
});

// The revisit invariant is structural: only this variant carries the revisit
// suggestion, and strict objects reject it everywhere else.
const revisitResultSchema = z.strictObject({
  ...baseShape,
  recommended_action: z.literal("revisit"),
  revisit: revisitSuggestionSchema,
});

export const enrichmentResultSchema = z.discriminatedUnion("recommended_action", [
  nonRevisitResultSchema,
  revisitResultSchema,
]);

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type RevisitSuggestion = z.infer<typeof revisitSuggestionSchema>;
export type NonRevisitResult = z.infer<typeof nonRevisitResultSchema>;
export type RevisitResult = z.infer<typeof revisitResultSchema>;
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
