import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { type Db, IdempotencyKeyConflictError } from "../../db/index.js";
import { normalizeUrl } from "../../utils/normalize-url.js";
import { requestHash } from "../../utils/request-hash.js";
import { jsonError } from "../shared/responses.js";
import { linkResponseSchema, toLinkResponse } from "./shared.js";

export const URL_MAX = 2048;
export const NOTE_MAX = 2000;
export const GOAL_MAX = 200;
export const IDEMPOTENCY_KEY_MAX = 200;

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

const saveLinkRoute = createRoute({
  method: "post",
  path: "/links",
  request: {
    headers: idempotencyKeyHeaderSchema,
    body: {
      required: true,
      content: { "application/json": { schema: saveLinkBodySchema } },
    },
  },
  responses: {
    201: {
      description: "Link created; exactly one enrichment job was queued with it",
      content: { "application/json": { schema: linkResponseSchema } },
    },
    200: {
      description: "Idempotent replay: this key already created this link",
      content: { "application/json": { schema: linkResponseSchema } },
    },
    400: jsonError("Invalid body or missing Idempotency-Key header; nothing was stored"),
    409: jsonError("Idempotency-Key was already used with a different request"),
    500: jsonError("Submission failed; neither link nor job was stored"),
  },
});

export function registerSaveLinkRoute(app: OpenAPIHono, db: Db): void {
  app.openapi(saveLinkRoute, async (c) => {
    const body = c.req.valid("json");
    const key = c.req.valid("header")["Idempotency-Key"];
    const normalized = normalizeUrl(body.url);
    const hash = requestHash({
      url: normalized,
      note: body.note ?? null,
      goal: body.goal ?? null,
    });

    const existing = await db.findIdempotencyKey(key);
    if (existing) {
      if (existing.requestHash !== hash) {
        return c.json({ error: "idempotency_key_conflict" }, 409);
      }
      const link = await db.getLink(existing.linkId);
      if (link) {
        return c.json(toLinkResponse(link), 200);
      }
    }

    try {
      const link = await db.createLinkWithJob({
        url: body.url,
        normalizedUrl: normalized,
        note: body.note ?? null,
        goal: body.goal ?? null,
        idempotencyKey: key,
        requestHash: hash,
      });
      return c.json(toLinkResponse(link), 201);
    } catch (err) {
      if (err instanceof IdempotencyKeyConflictError) {
        // Lost a race against an identical concurrent submission: serve the
        // winner's link, or report the conflict if the request differs.
        const winner = await db.findIdempotencyKey(key);
        if (winner && winner.requestHash === hash) {
          const link = await db.getLink(winner.linkId);
          if (link) {
            return c.json(toLinkResponse(link), 200);
          }
        }
        return c.json({ error: "idempotency_key_conflict" }, 409);
      }
      throw err;
    }
  });
}

function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}
