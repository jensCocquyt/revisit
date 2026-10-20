import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { type Item, imageUrl, type SearchResult } from "./api";
import {
  describeStatus,
  displayTitle,
  formatDay,
  formatShortDate,
  isTitledByUrl,
  kindLabels,
  modifierKey,
  sourceOf,
} from "./format";
import { LinkIcon } from "./icons";
import { latestQuery, recentQuery, searchQuery } from "./queries";
import { type Filters, isFiltered, noFilters, periodLabels, toSearchFilters } from "./search-bar";
import { StatusBadge } from "./status-badge";
import type { Layout } from "./use-layout";

export type Listing =
  | { state: "loading" }
  | { state: "searching" }
  | { state: "error"; message: string }
  | { state: "results"; results: SearchResult[]; refreshing: boolean }
  | { state: "recent"; items: Item[] }
  | { state: "no-match" }
  | { state: "nothing-in-range" }
  | { state: "nothing-saved" };

export function useListing(query: string, filters: Filters): Listing {
  const searchFilters = toSearchFilters(filters);
  const search = useQuery({ ...searchQuery(query, searchFilters), enabled: query !== "" });
  const recent = useQuery({ ...recentQuery(searchFilters), enabled: query === "" });
  if (query) {
    if (search.error) return { state: "error", message: search.error.message };
    if (!search.data || (search.data.length === 0 && search.isFetching)) {
      return { state: "searching" };
    }
    if (search.data.length === 0) return { state: "no-match" };
    return { state: "results", results: search.data, refreshing: search.isFetching };
  }
  if (recent.error) return { state: "error", message: recent.error.message };
  if (!recent.data) return { state: "loading" };
  if (recent.data.length > 0) return { state: "recent", items: recent.data };
  return isFiltered(filters) ? { state: "nothing-in-range" } : { state: "nothing-saved" };
}

export function listLabel(listing: Listing): string | null {
  switch (listing.state) {
    case "searching":
      return "searching…";
    case "results":
      return listing.refreshing ? "searching…" : "best matches first";
    case "recent":
      return "recent";
    default:
      return null;
  }
}

export function ListingView(props: {
  listing: Listing;
  query: string;
  filters: Filters;
  onFilters: (filters: Filters) => void;
  onClearSearch: () => void;
  openItemId: string | null;
  onOpen: (id: string) => void;
  layout: Layout;
}) {
  const { listing, layout } = props;
  const rowProps = { openItemId: props.openItemId, onOpen: props.onOpen, layout };
  switch (listing.state) {
    case "loading":
      return null;
    case "error":
      return (
        <p role="alert" className="listing-error">
          {listing.message}
        </p>
      );
    case "searching":
      return <Skeleton />;
    case "results":
      return (
        <ol className="rows" aria-label="Search results" aria-busy={listing.refreshing}>
          {listing.results.map((result) => (
            <ItemRow key={result.item.id} item={result.item} {...rowProps}>
              <Snippet parts={result.snippet} />
            </ItemRow>
          ))}
        </ol>
      );
    case "recent":
      return (
        <ol className="rows" aria-label="Recently saved">
          {listing.items.map((item) => (
            <ItemRow key={item.id} item={item} {...rowProps}>
              {item.note && <p className="row-snippet">{item.note}</p>}
            </ItemRow>
          ))}
        </ol>
      );
    case "no-match":
      return (
        <EmptyState title={`Nothing matches “${props.query}”.`}>
          <p className="empty-text">
            Try fewer words, or describe what it was about rather than what it said. Filters are set
            to {describeFilters(props.filters)}.
          </p>
          <button type="button" className="outline-button" onClick={props.onClearSearch}>
            Clear search
          </button>
        </EmptyState>
      );
    case "nothing-in-range":
      return <NothingInRange filters={props.filters} onFilters={props.onFilters} />;
    case "nothing-saved":
      return <NothingSaved layout={layout} />;
  }
}

function ItemRow(props: {
  item: Item;
  openItemId: string | null;
  onOpen: (id: string) => void;
  layout: Layout;
  children: ReactNode;
}) {
  const { item, layout } = props;
  const selected = props.openItemId === item.id;
  return (
    <li className="row" aria-current={selected || undefined}>
      <Thumbnail item={item} />
      <div className="row-main">
        <div className="row-heading">
          <button
            type="button"
            className="row-title"
            data-mono={isTitledByUrl(item) || undefined}
            onClick={() => props.onOpen(item.id)}
          >
            {displayTitle(item)}
          </button>
          {layout !== "phone" && <StatusBadge item={item} />}
        </div>
        {props.children}
      </div>
      <p className="row-meta">
        <span className="row-source">{sourceOf(item)}</span>
        <span>{formatShortDate(item.createdAt)}</span>
        {layout === "phone" && <StatusBadge item={item} />}
      </p>
    </li>
  );
}

function Thumbnail({ item }: { item: Item }) {
  if (describeStatus(item)?.tone === "danger") {
    return (
      <span className="thumb thumb-failed" aria-hidden="true">
        !
      </span>
    );
  }
  if (item.kind === "screenshot") {
    return <img className="thumb thumb-image" src={imageUrl(item.id)} alt="" loading="lazy" />;
  }
  return (
    <span className="thumb" aria-hidden="true">
      {item.kind === "link" ? <LinkIcon /> : "T"}
    </span>
  );
}

function Snippet({ parts }: { parts: SearchResult["snippet"] }) {
  let offset = 0;
  return (
    <p className="row-snippet">
      {parts.map((part) => {
        const key = offset;
        offset += part.text.length;
        return part.highlight ? (
          <mark key={key}>{part.text}</mark>
        ) : (
          <span key={key}>{part.text}</span>
        );
      })}
    </p>
  );
}

function Skeleton() {
  return (
    <div role="status" className="rows skeleton">
      <span className="visually-hidden">Searching…</span>
      {skeletonWidths.map(([title, snippet]) => (
        <div key={title} className="row" aria-hidden="true">
          <span className="thumb" />
          <div className="row-main">
            <span className="bar" style={{ width: title }} />
            <span className="bar bar-thin" style={{ width: snippet }} />
          </div>
          <span className="bar bar-thin row-meta" />
        </div>
      ))}
    </div>
  );
}

function NothingInRange(props: { filters: Filters; onFilters: (filters: Filters) => void }) {
  const { filters, onFilters } = props;
  const kind = filters.kind || undefined;
  const byTime = filters.period !== "any";
  const { data: latest } = useQuery({ ...latestQuery(kind), enabled: byTime });
  const subject = kind ? `No ${kindLabels[kind].toLowerCase()}` : "Nothing";
  const when = byTime ? `in the ${periodLabels[filters.period].toLowerCase()}` : "yet";
  return (
    <EmptyState title={`${subject} saved ${when}.`}>
      {byTime && latest && (
        <p className="empty-text">
          The most recent {kind ?? "item"} is from {formatDay(latest.createdAt)}.
        </p>
      )}
      <button
        type="button"
        className="accent-button"
        onClick={() =>
          onFilters(byTime ? { ...filters, period: noFilters.period } : { ...filters, kind: "" })
        }
      >
        {byTime ? "Show any time" : "Show all kinds"}
      </button>
    </EmptyState>
  );
}

function NothingSaved({ layout }: { layout: Layout }) {
  const { arrow, where } = startHints[layout];
  return (
    <EmptyState title="Nothing saved yet." large>
      <span className="empty-arrow" aria-hidden="true">
        {arrow}
      </span>
      <p className="empty-text">
        {where} Weeks later, find it here by describing it, in English, Dutch or French, or by an
        exact word.
      </p>
      {layout !== "phone" && (
        <p className="empty-keys">
          {modifierKey} V anywhere to paste · {modifierKey} ↵ to save · / to search
        </p>
      )}
    </EmptyState>
  );
}

function EmptyState(props: { title: string; large?: boolean; children: ReactNode }) {
  return (
    <div className="empty" data-large={props.large || undefined}>
      <h2 className="empty-title">{props.title}</h2>
      {props.children}
    </div>
  );
}

function describeFilters(filters: Filters): string {
  const kind = filters.kind ? kindLabels[filters.kind].toLowerCase() : "all kinds";
  return `${kind}, ${periodLabels[filters.period].toLowerCase()}`;
}

const startHints: Record<Layout, { arrow: string; where: string }> = {
  wide: { arrow: "←", where: "Paste a link, some text or a screenshot on the left." },
  narrow: { arrow: "↑", where: "Paste a link, some text or a screenshot above." },
  phone: { arrow: "↓", where: "Tap Add to save a link, some text or a screenshot." },
};

const skeletonWidths = [
  ["62%", "88%"],
  ["48%", "70%"],
  ["70%", "80%"],
  ["40%", "64%"],
  ["55%", "76%"],
];
