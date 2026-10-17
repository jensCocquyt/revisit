import type { Item, ItemKind } from "./api";

export function formatSavedAt(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function describeStatus(item: Item): string | null {
  if (item.status === "pending" || item.status === "processing") return "Reading…";
  if (item.status === "failed") return "Failed";
  return null;
}

export const kindLabels: Record<ItemKind, string> = { text: "Text" };

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
