import { z } from "@hono/zod-openapi";

export const URL_MAX = 2048;
export const NOTE_MAX = 2000;
export const GOAL_MAX = 200;
export const IDEMPOTENCY_KEY_MAX = 200;

function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

export const saveLinkBodySchema = z
  .strictObject({
    url: z
      .string()
      .max(URL_MAX)
      .refine(isHttpUrl, { message: "must be an absolute http or https URL" })
      .openapi({ example: "https://example.com/article" }),
    note: z.string().max(NOTE_MAX).optional().openapi({ example: "Relevant for the migration" }),
    goal: z.string().max(GOAL_MAX).optional().openapi({ example: "interview preparation" }),
  })
  .openapi("SaveLinkRequest");

// The schema key doubles as the documented header name; the validator maps
// incoming headers onto it case-insensitively.
export const idempotencyKeyHeaderSchema = z.object({
  "Idempotency-Key": z.string().min(1).max(IDEMPOTENCY_KEY_MAX).openapi({
    description: "Client-chosen key making retries of the same submission safe.",
    example: "5f0da7a8-16f9-4a52-9a51-3d34b75f24d1",
  }),
});

export const linkIdParamSchema = z.object({
  id: z.uuid().openapi({
    param: { name: "id", in: "path" },
    example: "0d9f6a1c-3b6e-4c2d-9f6a-1c3b6e4c2d9f",
  }),
});

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

export const errorResponseSchema = z
  .object({
    error: z.string(),
    details: z.unknown().optional(),
  })
  .openapi("Error");
