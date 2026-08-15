import { z } from "zod";

export const CONTRACT_VERSION = "v2";

// Names mirror the worker's pydantic models in apps/worker/worker/contract.py:
// EvidenceItem, Deadline, EnrichmentResult. Keep them in sync when the
// contract changes. v2 is flat: tags plus an optional, complete deadline
// whose source quotes the page sentence asserting the date.

const TAG_MAX_LENGTH = 50;
const TAGS_MAX_COUNT = 5;

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

const deadlineSchema = z.strictObject({
  date: z.iso.date(),
  reason: z.string().min(1).max(500),
  source: evidenceItemSchema,
});

const tagSchema = z
  .string()
  .min(1)
  .max(TAG_MAX_LENGTH)
  .refine((tag) => tag === tag.trim(), { message: "tag has leading or trailing whitespace" })
  .refine((tag) => tag === tag.toLowerCase(), { message: "tag must be lowercase" });

export const enrichmentResultSchema = z
  .strictObject({
    contract_version: z.literal(CONTRACT_VERSION),
    summary: z.string().min(1).max(2000),
    key_takeaway: z.string().min(1).max(500),
    tags: z.array(tagSchema).min(1).max(TAGS_MAX_COUNT),
    // .nullish(): pydantic's `Deadline | None = None` accepts both an absent
    // field and an explicit null — mirror both (fixture-pinned).
    deadline: deadlineSchema.nullish(),
    evidence: z.array(evidenceItemSchema).max(10),
  })
  .refine((result) => new Set(result.tags).size === result.tags.length, {
    message: "tags must be unique",
    path: ["tags"],
  });

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type Deadline = z.infer<typeof deadlineSchema>;
export type EnrichmentResult = z.infer<typeof enrichmentResultSchema>;

export interface ContractValidation {
  valid: boolean;
  errors: string[];
  data?: EnrichmentResult;
}

/** Validate an enrichment result against the v2 contract. */
export function validateEnrichmentResult(result: unknown): ContractValidation {
  const parsed = enrichmentResultSchema.safeParse(result);
  if (parsed.success) {
    return { valid: true, errors: [], data: parsed.data };
  }
  const errors = parsed.error.issues.map((issue) => `/${issue.path.join("/")} ${issue.message}`);
  return { valid: false, errors };
}
