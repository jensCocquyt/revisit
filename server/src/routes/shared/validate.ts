import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { type ZodType, z } from "zod";
import type { ErrorResponse } from "../../contract.js";

export function validate<Target extends keyof ValidationTargets, Schema extends ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json<ErrorResponse>({ error: z.prettifyError(result.error) }, 400);
    }
  });
}
