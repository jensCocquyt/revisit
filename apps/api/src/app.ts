import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { type Db, IdempotencyKeyConflictError, type LinkRow } from "./db.js";
import { normalizeUrl, requestHash } from "./normalize.js";
import {
  errorResponseSchema,
  idempotencyKeyHeaderSchema,
  linkIdParamSchema,
  linkResponseSchema,
  saveLinkBodySchema,
} from "./schema.js";

const healthResponseSchema = z
  .object({ status: z.string(), db: z.string() })
  .openapi("HealthStatus");

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      description: "API and database are reachable",
      content: { "application/json": { schema: healthResponseSchema } },
    },
    503: {
      description: "Database is unreachable",
      content: { "application/json": { schema: healthResponseSchema } },
    },
  },
});

const jsonError = (description: string) => ({
  description,
  content: { "application/json": { schema: errorResponseSchema } },
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

const getLinkRoute = createRoute({
  method: "get",
  path: "/links/{id}",
  request: { params: linkIdParamSchema },
  responses: {
    200: {
      description: "Current stored representation of the link",
      content: { "application/json": { schema: linkResponseSchema } },
    },
    400: jsonError("Malformed link id"),
    404: jsonError("No link with this id"),
  },
});

function toResponse(link: LinkRow) {
  return {
    id: link.id,
    url: link.url,
    note: link.note,
    goal: link.goal,
    status: link.status,
    created_at: link.created_at,
  };
}

export function createApp(db: Db): OpenAPIHono {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: "invalid_request", details: z.flattenError(result.error) }, 400);
      }
    },
  });

  app.onError((err, c) => {
    console.error(
      JSON.stringify({
        msg: "unhandled error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json({ error: "internal_error" }, 500);
  });

  app.openapi(healthRoute, async (c) => {
    try {
      await db.ping();
      return c.json({ status: "ok", db: "ok" }, 200);
    } catch {
      return c.json({ status: "degraded", db: "error" }, 503);
    }
  });

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
        return c.json(toResponse(link), 200);
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
      return c.json(toResponse(link), 201);
    } catch (err) {
      if (err instanceof IdempotencyKeyConflictError) {
        // Lost a race against an identical concurrent submission: serve the
        // winner's link, or report the conflict if the request differs.
        const winner = await db.findIdempotencyKey(key);
        if (winner && winner.requestHash === hash) {
          const link = await db.getLink(winner.linkId);
          if (link) {
            return c.json(toResponse(link), 200);
          }
        }
        return c.json({ error: "idempotency_key_conflict" }, 409);
      }
      throw err;
    }
  });

  app.openapi(getLinkRoute, async (c) => {
    const { id } = c.req.valid("param");
    const link = await db.getLink(id);
    if (!link) {
      return c.json({ error: "link_not_found" }, 404);
    }
    return c.json(toResponse(link), 200);
  });

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Revisit API",
      version: "0.1.0",
      description: "Save a link, retrieve it, and queue its enrichment.",
    },
  });

  app.get("/docs", swaggerUI({ url: "/openapi.json" }));

  return app;
}
