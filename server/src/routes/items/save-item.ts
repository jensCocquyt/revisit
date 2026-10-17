import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { AppDeps } from "../../app.js";
import type { ErrorResponse, Item } from "../../contract.js";
import { findLinkItem, insertItem, type NewItem } from "../../db/items.js";
import { normalizeLinkUrl } from "../../links/normalize-url.js";
import { detectImageType } from "../../screenshots/image-type.js";

// JSON for text and links, multipart with an `image` file for screenshots.
export function registerSaveItemRoute(app: Hono, deps: AppDeps): void {
  app.post("/api/items", bodyLimit({ maxSize: maxRequestBytes, onError: tooLarge }), async (c) => {
    const isUpload = c.req.header("content-type")?.startsWith("multipart/form-data") ?? false;
    const parsed = isUpload ? await screenshotItem(c) : await jsonItem(c);
    if ("error" in parsed) return c.json<ErrorResponse>(parsed, 400);
    const item = await insertItem(deps.pool, parsed);
    if (!item) {
      const existing = await findLinkItem(deps.pool, parsed.url ?? "");
      if (!existing) throw new Error("a saved link with this address vanished while saving");
      return c.json<Item>(existing, 200);
    }
    deps.processor.wake();
    return c.json<Item>(item, 201);
  });
}

const maxImageBytes = 10 * 1024 * 1024;
const maxRequestBytes = maxImageBytes + 64 * 1024;
const maxTitleLength = 120;

const optionalNote = z.string().trim().max(2000).optional();

const jsonBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string().trim().min(1).max(200_000),
    note: optionalNote,
  }),
  z.object({
    kind: z.literal("link"),
    url: z.string().trim().min(1).max(2000),
    note: optionalNote,
  }),
]);

const uploadBody = z.object({ image: z.instanceof(File), note: optionalNote });

async function jsonItem(c: Context): Promise<NewItem | ErrorResponse> {
  const result = jsonBody.safeParse(await c.req.json().catch(() => undefined));
  if (!result.success) return { error: z.prettifyError(result.error) };
  const body = result.data;
  const note = body.note ?? null;
  if (body.kind === "text") {
    return { kind: "text", url: null, title: titleFromText(body.text), note, body: body.text };
  }
  const url = normalizeLinkUrl(body.url);
  if (!url) return { error: "not an http or https address" };
  return { kind: "link", url, title: null, note, body: null };
}

async function screenshotItem(c: Context): Promise<NewItem | ErrorResponse> {
  const result = uploadBody.safeParse(await c.req.parseBody());
  if (!result.success) return { error: z.prettifyError(result.error) };
  const { image, note } = result.data;
  if (image.size > maxImageBytes) return { error: "the image is larger than 10 MB" };
  const bytes = Buffer.from(await image.arrayBuffer());
  const mediaType = detectImageType(bytes);
  if (!mediaType) return { error: "not a PNG, JPEG, WebP or GIF image" };
  return {
    kind: "screenshot",
    url: null,
    title: null,
    note: note ?? null,
    body: null,
    image: { bytes, mediaType },
  };
}

function tooLarge(c: Context) {
  return c.json<ErrorResponse>({ error: "the upload is larger than 10 MB" }, 413);
}

function titleFromText(text: string): string {
  const firstLine = text.split("\n", 1)[0]?.trim() ?? "";
  return firstLine.length > maxTitleLength
    ? `${firstLine.slice(0, maxTitleLength - 1).trimEnd()}…`
    : firstLine;
}
