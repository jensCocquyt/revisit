import { keepPreviousData, type QueryClient, queryOptions } from "@tanstack/react-query";
import {
  getItem,
  type ItemKind,
  isInProgress,
  listItems,
  type SearchFilters,
  searchItems,
} from "./api";

export function itemQuery(id: string) {
  return queryOptions({
    queryKey: ["item", id],
    queryFn: () => getItem(id),
    refetchInterval: (query) =>
      query.state.data && isInProgress(query.state.data) ? pollIntervalMs : false,
  });
}

export function recentQuery(filters: SearchFilters) {
  return queryOptions({
    queryKey: ["items", filters],
    queryFn: () => listItems(filters),
    refetchInterval: (query) => (query.state.data?.some(isInProgress) ? pollIntervalMs : false),
  });
}

export function latestQuery(kind: ItemKind | undefined) {
  return queryOptions({
    queryKey: ["items", { kind }, "latest"],
    queryFn: async () => (await listItems({ kind }, 1))[0] ?? null,
  });
}

export function searchQuery(query: string, filters: SearchFilters) {
  return queryOptions({
    queryKey: ["search", query, filters],
    queryFn: () => searchItems(query, filters),
    placeholderData: keepPreviousData,
  });
}

export function refreshLists(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["items"] });
  queryClient.invalidateQueries({ queryKey: ["search"] });
}

const pollIntervalMs = 1500;
