import { createHash } from "node:crypto";

export interface NormalizedRequest {
  url: string;
  note: string | null;
  goal: string | null;
}

// Canonical idempotency hash. Pass missing optionals as null so omission and
// explicit null hash identically; key order is fixed by construction.
export function requestHash(request: NormalizedRequest): string {
  const canonical = JSON.stringify({ url: request.url, note: request.note, goal: request.goal });
  return createHash("sha256").update(canonical).digest("hex");
}
