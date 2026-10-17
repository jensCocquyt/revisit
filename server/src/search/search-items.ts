import type pg from "pg";
import type { MatchMethod, SearchResult, SnippetPart } from "../contract.js";
import { type ItemFilters, type ItemRow, itemColumns, toItem } from "../db/items.js";
import type { Embed } from "../embedding/embed.js";
import { type PassageHit, type RankedList, rankItems } from "./rank-items.js";

export type SearchDeps = { pool: pg.Pool; embed: Embed };

export async function searchItems(
  deps: SearchDeps,
  query: string,
  filters: ItemFilters,
): Promise<SearchResult[]> {
  const [vector] = await deps.embed([query], "query");
  if (!vector) throw new Error("query embedding missing");
  const filterParams = [filters.kind ?? null, filters.from ?? null, filters.to ?? null];
  const lists = await Promise.all([
    findHits(deps.pool, "meaning", meaningSql, [JSON.stringify(vector), ...filterParams]),
    findHits(deps.pool, "words", wordsSql, [query, ...filterParams]),
    query.length >= minFragmentLength
      ? findHits(deps.pool, "fragment", fragmentSql, [query, ...filterParams])
      : { method: "fragment" as const, hits: [] },
  ]);
  const ranked = rankItems(lists).slice(0, resultLimit);
  if (ranked.length === 0) return [];
  const { rows } = await deps.pool.query<ResultRow>(resultsSql, [
    ranked.map((result) => result.passageId),
    query,
    headlineOptions,
  ]);
  const rowsByPassage = new Map(rows.map((row) => [row.passageId, row]));
  return ranked.flatMap((result) => {
    const row = rowsByPassage.get(result.passageId);
    if (!row) return [];
    return [{ item: toItem(row), snippet: parseSnippet(row.snippet), matchedBy: result.matchedBy }];
  });
}

// From the eval: related passages score above 0.3, unrelated ones below 0.22.
const minMeaningSimilarity = 0.25;
const candidateLimit = 50;
const resultLimit = 20;
const minFragmentLength = 3;
const highlightStart = "";
const highlightEnd = "";
const headlineOptions = `StartSel=${highlightStart}, StopSel=${highlightEnd}, MaxWords=40, MinWords=20, ShortWord=2`;

const candidateColumns = `passages.id::text AS "passageId", passages.item_id AS "itemId"`;
const fromPassages = "FROM passages JOIN items ON items.id = passages.item_id";
const filters = `($2::text IS NULL OR items.kind = $2)
  AND ($3::timestamptz IS NULL OR items.created_at >= $3)
  AND ($4::timestamptz IS NULL OR items.created_at < $4)`;

const meaningSql = `SELECT ${candidateColumns} ${fromPassages}
  WHERE ${filters} AND passages.embedding <=> $1::vector < ${1 - minMeaningSimilarity}
  ORDER BY passages.embedding <=> $1::vector
  LIMIT ${candidateLimit}`;

const wordsSql = `SELECT ${candidateColumns} ${fromPassages}
  WHERE ${filters} AND passages.words @@ websearch_to_tsquery('simple', $1)
  ORDER BY ts_rank_cd(passages.words, websearch_to_tsquery('simple', $1)) DESC
  LIMIT ${candidateLimit}`;

const fragmentSql = `SELECT ${candidateColumns} ${fromPassages}
  WHERE ${filters} AND $1 <% passages.text
  ORDER BY word_similarity($1, passages.text) DESC
  LIMIT ${candidateLimit}`;

const resultsSql = `SELECT passages.id::text AS "passageId",
    ts_headline('simple', passages.text, websearch_to_tsquery('simple', $2), $3) AS snippet,
    ${itemColumns("items")}
  ${fromPassages}
  WHERE passages.id = ANY($1::bigint[])`;

type ResultRow = ItemRow & { passageId: string; snippet: string };

async function findHits(
  pool: pg.Pool,
  method: MatchMethod,
  sql: string,
  params: unknown[],
): Promise<RankedList> {
  const { rows } = await pool.query<PassageHit>(sql, params);
  return { method, hits: rows };
}

function parseSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  for (const [index, segment] of snippet.split(highlightStart).entries()) {
    const [highlighted, rest] = index === 0 ? [null, segment] : splitOnce(segment, highlightEnd);
    if (highlighted) parts.push({ text: highlighted, highlight: true });
    if (rest) parts.push({ text: rest, highlight: false });
  }
  return parts;
}

function splitOnce(text: string, separator: string): [string, string] {
  const at = text.indexOf(separator);
  return at === -1 ? [text, ""] : [text.slice(0, at), text.slice(at + separator.length)];
}
