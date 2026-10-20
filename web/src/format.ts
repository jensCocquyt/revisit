import type { Item, ItemKind } from "./api";

export type Status = { label: string; tone: "info" | "danger" | "warn" };

export function formatSavedAt(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

export function formatShortDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (now.getTime() - date.getTime() < 60_000) return "just now";
  if (date.toDateString() === now.toDateString()) return timeFormat.format(date);
  return formatDay(iso, now).toLowerCase();
}

export function formatDay(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const format = date.getFullYear() === now.getFullYear() ? dayFormat : dayYearFormat;
  return format.format(date);
}

export function describeStatus(item: Item): Status | null {
  if (item.status === "pending" || item.status === "processing") {
    return { label: "Reading…", tone: "info" };
  }
  if (item.status === "failed") return { label: "Failed", tone: "danger" };
  if (item.error) return { label: "Page not read", tone: "warn" };
  return null;
}

export function displayTitle(item: Item): string {
  return item.title || item.url?.replace(/^https?:\/\//, "") || "Untitled";
}

export function isTitledByUrl(item: Item): boolean {
  return !item.title && item.url !== null;
}

export function hostOf(item: Item): string | null {
  return item.url ? new URL(item.url).hostname : null;
}

export function sourceOf(item: Item): string {
  return hostOf(item) ?? item.kind;
}

export function asSentence(message: string): string {
  const text = message.trim().replace(/[\s:;,]+$/, "");
  const capitalized = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?…]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const kindLabels: Record<ItemKind, string> = {
  text: "Text",
  link: "Links",
  screenshot: "Screenshots",
};

export const modifierKey = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const dayYearFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
