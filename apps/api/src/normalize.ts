import { createHash } from "node:crypto";

// Minimal, deterministic normalization: WHATWG URL parsing already lowercases
// the scheme and host and strips default ports; we additionally drop the
// fragment. Query strings are preserved untouched — reordering or stripping
// params would be guesswork.
export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  return url.toString();
}

export interface NormalizedRequest {
  url: string;
  note: string | null;
  goal: string | null;
}

// Canonical request hash for idempotency. Key order is fixed by construction
// and missing optionals must be passed as null so omission and explicit null
// hash identically.
export function requestHash(request: NormalizedRequest): string {
  const canonical = JSON.stringify({
    url: request.url,
    note: request.note,
    goal: request.goal,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
