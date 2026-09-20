import type { EnrichmentResult } from "../src/contract.js";
import type { EnrichmentRow, LinkRow } from "../src/db/index.js";

export const extractedText =
  "Python 3.9 reaches end of life on 2025-10-31. Upgrade before support ends. Later versions remain supported.";

export function validResult(overrides: Partial<EnrichmentResult> = {}): EnrichmentResult {
  return {
    contract_version: "v2",
    summary: "Python 3.9 support ends in October 2025.",
    key_takeaway: "Upgrade before support ends.",
    tags: ["python", "eol"],
    deadline: {
      date: "2025-10-31",
      reason: "Security fixes stop at end of life.",
      source: {
        quote: "Python 3.9 reaches end of life on 2025-10-31.",
        start_offset: 0,
        end_offset: 45,
      },
    },
    evidence: [
      { quote: "Upgrade before support ends.", start_offset: 46, end_offset: 74 },
      { quote: "Later versions remain supported.", start_offset: 75, end_offset: 107 },
    ],
    ...overrides,
  };
}

export function storedLink(overrides: Partial<LinkRow> = {}): LinkRow {
  return {
    id: "0d9f6a1c-3b6e-4c2d-9f6a-1c3b6e4c2d9f",
    url: "https://example.com/article",
    note: null,
    goal: null,
    status: "enriched",
    created_at: "2026-08-17T00:00:00.000Z",
    updated_at: "2026-08-17T00:00:00.000Z",
    latest_result: null,
    ...overrides,
  };
}

export function storedEnrichment(overrides: Partial<EnrichmentRow> = {}): EnrichmentRow {
  return {
    link_id: storedLink().id,
    created_at: "2026-08-17T00:05:00.000Z",
    model_id: "stub",
    prompt_version: "stub-v2",
    result: validResult(),
    extracted_text: extractedText,
    ...overrides,
  };
}
