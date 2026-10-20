import { useRef, useState } from "react";
import { AddForm, type Draft, emptyDraft } from "./add-form";
import { AddSheet } from "./add-sheet";
import type { SavedItem } from "./api";
import { ListingView, listLabel, useListing } from "./item-lists";
import { ItemPanel } from "./item-panel";
import { JustAdded } from "./just-added";
import { SavedToast } from "./saved-toast";
import { type Filters, noFilters, SearchBar } from "./search-bar";
import { useSlashToFocus } from "./shortcuts";
import { useDebounced } from "./use-debounced";
import { useLayout } from "./use-layout";

export function App() {
  const layout = useLayout();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [justAdded, setJustAdded] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<SavedItem | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchedQuery = useDebounced(query.trim(), 250);
  const listing = useListing(searchedQuery, filters);
  const label = listLabel(listing);
  const onPhone = layout === "phone";
  useSlashToFocus(searchInput);

  function saved(result: SavedItem) {
    const { id } = result.item;
    setJustAdded((ids) => [id, ...ids.filter((other) => other !== id)].slice(0, 3));
    if (onPhone) setSheetOpen(false);
    if (layout !== "wide") setToast(result);
  }

  function forget(id: string) {
    setJustAdded((ids) => ids.filter((other) => other !== id));
    setToast((current) => (current?.item.id === id ? null : current));
  }

  const form = <AddForm draft={draft} onDraft={setDraft} onSaved={saved} inSheet={onPhone} />;
  return (
    <div className="app">
      {!onPhone && (
        <aside className="rail" aria-label="Add">
          <Logo />
          {form}
          {layout === "wide" && <JustAdded ids={justAdded} onOpen={setOpenItemId} />}
        </aside>
      )}
      <main className="main">
        <div className="search-area">
          {onPhone && <Logo />}
          <SearchBar
            inputRef={searchInput}
            query={query}
            onQuery={setQuery}
            filters={filters}
            onFilters={setFilters}
            showFilters={listing.state !== "nothing-saved"}
            label={onPhone ? null : label}
            placeholder={onPhone ? "Search your saves" : "Search by meaning or exact words"}
          />
        </div>
        {onPhone && label && <p className="list-label">{label}</p>}
        <ListingView
          listing={listing}
          query={searchedQuery}
          filters={filters}
          onFilters={setFilters}
          onClearSearch={() => setQuery("")}
          openItemId={openItemId}
          onOpen={setOpenItemId}
          layout={layout}
        />
      </main>
      {onPhone && (
        <AddSheet open={sheetOpen} onOpenChange={setSheetOpen}>
          {form}
        </AddSheet>
      )}
      {layout !== "wide" && toast && (
        <SavedToast
          key={toast.item.id}
          saved={toast}
          onDone={() => setToast(null)}
          onUndone={forget}
        />
      )}
      {openItemId && (
        <ItemPanel
          key={openItemId}
          id={openItemId}
          layout={layout}
          onClose={() => setOpenItemId(null)}
          onDeleted={forget}
        />
      )}
    </div>
  );
}

function Logo() {
  return (
    <h1 className="logo">
      revisit
      <span className="logo-dot" aria-hidden="true">
        .
      </span>
    </h1>
  );
}
