import { useState } from "react";
import { CaptureBar } from "./capture-bar";
import { RecentItems, SearchResultList } from "./item-lists";
import { ItemPanel } from "./item-panel";
import { type Filters, SearchBar } from "./search-bar";
import { useDebounced } from "./use-debounced";

export function App() {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>({ kind: "", period: "any" });
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const searchedQuery = useDebounced(query.trim(), 250);

  return (
    <main className="page">
      <header className="masthead">
        <h1>Revisit</h1>
      </header>
      <CaptureBar />
      <SearchBar query={query} onQuery={setQuery} filters={filters} onFilters={setFilters} />
      {searchedQuery ? (
        <SearchResultList query={searchedQuery} filters={filters} onOpen={setOpenItemId} />
      ) : (
        <RecentItems filters={filters} onOpen={setOpenItemId} />
      )}
      {openItemId && <ItemPanel id={openItemId} onClose={() => setOpenItemId(null)} />}
    </main>
  );
}
