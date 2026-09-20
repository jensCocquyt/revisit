export interface LinkRow {
  id: string;
  url: string;
  note: string | null;
  goal: string | null;
  status: "pending" | "enriched" | "failed";
  created_at: string;
  updated_at: string;
  latest_result: unknown;
}

export interface ListLinksInput {
  status?: LinkRow["status"];
  tag?: string;
  limit: number;
  afterId?: string;
}

export interface LinkPage {
  items: LinkRow[];
  hasMore: boolean;
}

export interface EnrichmentRow {
  link_id: string;
  created_at: string;
  model_id: string | null;
  prompt_version: string;
  result: unknown;
  extracted_text: string | null;
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

// The paging cursor names no stored link, so the page it asks for has no
// position; serving an empty page would read as "you reached the end".
export class CursorNotFoundError extends Error {
  constructor() {
    super("cursor does not identify a stored link");
    this.name = "CursorNotFoundError";
  }
}

export interface Db {
  ping(): Promise<void>;
  getLink(id: string): Promise<LinkRow | null>;
  listLinks(input: ListLinksInput): Promise<LinkPage>;
  getEnrichment(linkId: string): Promise<EnrichmentRow | null>;
  findIdempotencyKey(key: string): Promise<IdempotencyKeyRow | null>;
  createLinkWithJob(input: CreateLinkWithJobInput): Promise<LinkRow>;
}
