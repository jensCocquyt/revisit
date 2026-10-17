import type { Item, ItemKind } from "./api";

export function formatSavedAt(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function describeStatus(item: Item): string | null {
  if (item.status === "pending" || item.status === "processing") return "Reading…";
  if (item.status === "failed") return "Failed";
  if (item.error) return "Page not read";
  return null;
}

export function displayTitle(item: Item): string {
  return item.title || item.url || "Untitled";
}

export function hostOf(item: Item): string | null {
  return item.url ? new URL(item.url).hostname : null;
}

export const kindLabels: Record<ItemKind, string> = { text: "Text", link: "Link" };

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
