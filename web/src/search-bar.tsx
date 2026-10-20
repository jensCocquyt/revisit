import type { RefObject } from "react";
import type { ItemKind, SearchFilters } from "./api";
import { kindLabels } from "./format";
import { CloseIcon, SearchIcon } from "./icons";

export function SearchBar(props: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (query: string) => void;
  filters: Filters;
  onFilters: (filters: Filters) => void;
  showFilters: boolean;
  label: string | null;
  placeholder: string;
}) {
  const { query, onQuery, filters, onFilters } = props;
  return (
    <search className="search">
      <div className="search-box">
        <SearchIcon />
        <input
          ref={props.inputRef}
          type="search"
          aria-label="Search"
          aria-keyshortcuts="/"
          placeholder={props.placeholder}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
        {query && (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear search"
            onClick={() => onQuery("")}
          >
            <CloseIcon />
          </button>
        )}
        <span className="key search-key" aria-hidden="true">
          /
        </span>
      </div>
      {props.showFilters && (
        <div className="filters">
          <fieldset className="chips">
            <legend className="visually-hidden">Kind</legend>
            {kindOptions.map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                className="chip"
                aria-pressed={filters.kind === kind}
                onClick={() => onFilters({ ...filters, kind })}
              >
                {label}
              </button>
            ))}
            <span className="chip-select">
              <select
                aria-label="Saved"
                className="chip"
                data-active={filters.period !== "any" || undefined}
                value={filters.period}
                onChange={(event) =>
                  onFilters({ ...filters, period: event.target.value as Period })
                }
              >
                {periods.map((period) => (
                  <option key={period} value={period}>
                    {periodLabels[period]}
                  </option>
                ))}
              </select>
            </span>
          </fieldset>
          {props.label && <span className="list-label">{props.label}</span>}
        </div>
      )}
    </search>
  );
}

export type Period = "any" | "week" | "month" | "year";

export type Filters = { kind: ItemKind | ""; period: Period };

export const noFilters: Filters = { kind: "", period: "any" };

export function isFiltered(filters: Filters): boolean {
  return filters.kind !== noFilters.kind || filters.period !== noFilters.period;
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

export const periodLabels: Record<Period, string> = {
  any: "Any time",
  week: "Past week",
  month: "Past month",
  year: "Past year",
};

const periods = Object.keys(periodLabels) as Period[];

const kindOptions: [ItemKind | "", string][] = [
  ["", "All"],
  ["text", kindLabels.text],
  ["link", kindLabels.link],
  ["screenshot", kindLabels.screenshot],
];

const daysByPeriod: Record<Period, number | undefined> = {
  any: undefined,
  week: 7,
  month: 31,
  year: 365,
};
