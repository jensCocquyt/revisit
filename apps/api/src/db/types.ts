export interface LinkRow {
  id: string;
  url: string;
  note: string | null;
  goal: string | null;
  status: "pending" | "enriched" | "failed";
  created_at: string;
  updated_at: string;
}

export interface IdempotencyKeyRow {
  key: string;
  requestHash: string;
  linkId: string;
}

export interface CreateLinkWithJobInput {
  url: string;
  normalizedUrl: string;
  note: string | null;
  goal: string | null;
  idempotencyKey: string;
  requestHash: string;
}

// The submitted idempotency key already exists; the caller decides between
// replaying the stored link and reporting a conflict.
export class IdempotencyKeyConflictError extends Error {
  constructor() {
    super("idempotency key already exists");
    this.name = "IdempotencyKeyConflictError";
  }
}

export interface Db {
  ping(): Promise<void>;
  getLink(id: string): Promise<LinkRow | null>;
  findIdempotencyKey(key: string): Promise<IdempotencyKeyRow | null>;
  createLinkWithJob(input: CreateLinkWithJobInput): Promise<LinkRow>;
}
