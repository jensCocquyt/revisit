import type pg from "pg";
import type { EnrichmentRow } from "./types.js";

export async function getEnrichment(pool: pg.Pool, linkId: string): Promise<EnrichmentRow | null> {
  const result = await pool.query<RawEnrichmentRow>(
    `SELECT e.link_id, e.created_at, e.model_id, e.prompt_version, e.result, cv.extracted_text
     FROM enrichments e
     LEFT JOIN content_versions cv ON cv.id = e.content_version_id
     WHERE e.link_id = $1
     ORDER BY e.created_at DESC
     LIMIT 1`,
    [linkId],
  );
  const row = result.rows[0];
  return row ? { ...row, created_at: row.created_at.toISOString() } : null;
}

interface RawEnrichmentRow {
  link_id: string;
  created_at: Date;
  model_id: string | null;
  prompt_version: string;
  result: unknown;
  extracted_text: string | null;
}
