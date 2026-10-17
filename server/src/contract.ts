// Shapes the web app reads and sends. Keep this file free of imports: the web app type-checks it.

export type ItemKind = "text" | "link";

export type ItemStatus = "pending" | "processing" | "ready" | "failed";

export type Item = {
  id: string;
  kind: ItemKind;
  url: string | null;
  title: string | null;
  note: string | null;
  status: ItemStatus;
  error: string | null;
  createdAt: string;
  processedAt: string | null;
};

export type ItemDetail = Item & { body: string | null };

export type SaveItemRequest =
  | { kind: "text"; text: string; note?: string }
  | { kind: "link"; url: string; note?: string };

export type ItemList = { items: Item[] };

export type MatchMethod = "meaning" | "words" | "fragment";

export type SnippetPart = { text: string; highlight: boolean };

export type SearchResult = { item: Item; snippet: SnippetPart[]; matchedBy: MatchMethod[] };

export type SearchResults = { results: SearchResult[] };

export type ErrorResponse = { error: string };
