import type {
  ErrorResponse,
  Item,
  ItemDetail,
  ItemKind,
  ItemList,
  SaveItemRequest,
  SearchResult,
  SearchResults,
} from "../../server/src/contract";

export type { Item, ItemDetail, ItemKind, SearchResult };

export type SearchFilters = { kind?: ItemKind; from?: string };

export type Capture = SaveItemRequest | { kind: "screenshot"; image: File; note?: string };

export async function listItems(filters: SearchFilters): Promise<Item[]> {
  return (await request<ItemList>(`/api/items?${filterParams(filters)}`)).items;
}

export function getItem(id: string): Promise<ItemDetail> {
  return request<ItemDetail>(`/api/items/${id}`);
}

export function saveItem(capture: Capture): Promise<Item> {
  if (capture.kind === "screenshot") {
    const form = new FormData();
    form.set("image", capture.image);
    if (capture.note) form.set("note", capture.note);
    return request<Item>("/api/items", { method: "POST", body: form });
  }
  return request<Item>("/api/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(capture),
  });
}

export function imageUrl(id: string): string {
  return `/api/items/${id}/image`;
}

export function retryItem(id: string): Promise<Item> {
  return request<Item>(`/api/items/${id}/retry`, { method: "POST" });
}

export async function deleteItem(id: string): Promise<void> {
  await request<void>(`/api/items/${id}`, { method: "DELETE" });
}

export async function searchItems(q: string, filters: SearchFilters): Promise<SearchResult[]> {
  const params = filterParams(filters);
  params.set("q", q);
  return (await request<SearchResults>(`/api/search?${params}`)).results;
}

export function isInProgress(item: Item): boolean {
  return item.status === "pending" || item.status === "processing";
}

function filterParams(filters: SearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.from) params.set("from", filters.from);
  return params;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ErrorResponse | null;
    throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}
