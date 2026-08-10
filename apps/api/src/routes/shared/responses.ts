import { z } from "@hono/zod-openapi";

export const errorResponseSchema = z
  .object({
    error: z.string(),
    details: z.unknown().optional(),
  })
  .openapi("Error");

export const jsonError = (description: string) => ({
  description,
  content: { "application/json": { schema: errorResponseSchema } },
});
