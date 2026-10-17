import type { ItemKind, SearchFilters } from "./api";

export type Period = "any" | "week" | "month" | "year";

export type Filters = { kind: ItemKind | ""; period: Period };

export function SearchBar(props: {
  query: string;
  onQuery: (query: string) => void;
  filters: Filters;
  onFilters: (filters: Filters) => void;
}) {
  const { query, onQuery, filters, onFilters } = props;
  return (
    <search className="search">
      <input
        type="search"
        aria-label="Search"
        placeholder="Search by meaning or exact words"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
      />
      <select
        aria-label="Kind"
        value={filters.kind}
        onChange={(event) => onFilters({ ...filters, kind: event.target.value as ItemKind | "" })}
      >
        <option value="">All kinds</option>
        <option value="text">Text</option>
        <option value="link">Links</option>
      </select>
      <select
        aria-label="Saved"
        value={filters.period}
        onChange={(event) => onFilters({ ...filters, period: event.target.value as Period })}
      >
        <option value="any">Any time</option>
        <option value="week">Past week</option>
        <option value="month">Past month</option>
        <option value="year">Past year</option>
      </select>
    </search>
  );
}

// Starts at local midnight so the value, and with it the query key, is stable for the day.
export function toSearchFilters(filters: Filters, now = new Date()): SearchFilters {
  const days = daysByPeriod[filters.period];
  if (!days) return { kind: filters.kind || undefined };
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - days);
  return { kind: filters.kind || undefined, from: from.toISOString() };
}

const daysByPeriod: Record<Period, number | undefined> = {
  any: undefined,
  week: 7,
  month: 31,
  year: 365,
};
