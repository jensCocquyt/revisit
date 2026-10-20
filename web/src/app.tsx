import { useRef, useState } from "react";
import { AddForm, type Draft, emptyDraft } from "./add-form";
import { AddSheet, SavedToast } from "./add-sheet";
import type { Item } from "./api";
import { ListingView, listLabel, useListing } from "./item-lists";
import { ItemPanel } from "./item-panel";
import { JustAdded } from "./just-added";
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
  const [toastItem, setToastItem] = useState<Item | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchedQuery = useDebounced(query.trim(), 250);
  const listing = useListing(searchedQuery, filters);
  const label = listLabel(listing);
  const onPhone = layout === "phone";
  useSlashToFocus(searchInput);

  function saved(item: Item) {
    setJustAdded((ids) => [item.id, ...ids.filter((id) => id !== item.id)].slice(0, 3));
    if (onPhone) {
      setSheetOpen(false);
      setToastItem(item);
    }
  }

  function forget(id: string) {
    setJustAdded((ids) => ids.filter((other) => other !== id));
    setToastItem((item) => (item?.id === id ? null : item));
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
        <>
          {toastItem && (
            <SavedToast
              key={toastItem.id}
              item={toastItem}
              onDone={() => setToastItem(null)}
              onUndone={forget}
            />
          )}
          <AddSheet open={sheetOpen} onOpenChange={setSheetOpen}>
            {form}
          </AddSheet>
        </>
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
