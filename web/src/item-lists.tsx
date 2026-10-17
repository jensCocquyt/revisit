import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { type Item, isInProgress, listItems, type SearchResult, searchItems } from "./api";
import { describeStatus, displayTitle, formatSavedAt, hostOf, kindLabels } from "./format";
import { type Filters, toSearchFilters } from "./search-bar";

type OpenItem = (id: string) => void;

export function RecentItems({ filters, onOpen }: { filters: Filters; onOpen: OpenItem }) {
  const searchFilters = toSearchFilters(filters);
  const { data, error } = useQuery({
    queryKey: ["items", searchFilters],
    queryFn: () => listItems(searchFilters),
    refetchInterval: (query) => (query.state.data?.some(isInProgress) ? 1500 : false),
  });
  if (error) return <p className="error">{error.message}</p>;
  if (!data) return null;
  if (data.length === 0) {
    const filtered = filters.kind !== "" || filters.period !== "any";
    return (
      <p className="empty">{filtered ? "Nothing saved in this range." : "Nothing saved yet."}</p>
    );
  }
  return (
    <ul className="items" aria-label="Recently saved">
      {data.map((item) => (
        <ItemRow key={item.id} item={item} onOpen={onOpen}>
          {item.note && <p className="note">{item.note}</p>}
        </ItemRow>
      ))}
    </ul>
  );
}

export function SearchResultList(props: { query: string; filters: Filters; onOpen: OpenItem }) {
  const filters = toSearchFilters(props.filters);
  const { data, error, isFetching } = useQuery({
    queryKey: ["search", props.query, filters],
    queryFn: () => searchItems(props.query, filters),
    placeholderData: keepPreviousData,
  });
  if (error) return <p className="error">{error.message}</p>;
  if (!data) return <p className="empty">Searching…</p>;
  if (data.length === 0) return <p className="empty">No matches.</p>;
  return (
    <ul className="items" aria-label="Search results" aria-busy={isFetching}>
      {data.map((result) => (
        <ItemRow key={result.item.id} item={result.item} onOpen={props.onOpen}>
          <Snippet parts={result.snippet} />
          <p className="matched-by">
            {result.matchedBy.map((method) => matchLabels[method]).join(" · ")}
          </p>
        </ItemRow>
      ))}
    </ul>
  );
}

function ItemRow({
  item,
  onOpen,
  children,
}: {
  item: Item;
  onOpen: OpenItem;
  children: ReactNode;
}) {
  const status = describeStatus(item);
  return (
    <li>
      <button type="button" className="item" onClick={() => onOpen(item.id)}>
        <span className="item-title">{displayTitle(item)}</span>
        <span className="item-meta">
          {[kindLabels[item.kind], hostOf(item), formatSavedAt(item.createdAt)]
            .filter(Boolean)
            .join(" · ")}
          {status && <span className={`status${item.error ? " status-error" : ""}`}>{status}</span>}
        </span>
        {children}
      </button>
    </li>
  );
}

function Snippet({ parts }: { parts: SearchResult["snippet"] }) {
  let offset = 0;
  return (
    <p className="snippet">
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

const matchLabels: Record<SearchResult["matchedBy"][number], string> = {
  words: "exact words",
  fragment: "partial text",
  meaning: "similar meaning",
};
