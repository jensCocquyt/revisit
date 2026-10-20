import { useQueries } from "@tanstack/react-query";
import { displayTitle, formatShortDate, sourceOf } from "./format";
import { itemQuery } from "./queries";
import { StatusBadge } from "./status-badge";

export function JustAdded(props: { ids: string[]; onOpen: (id: string) => void }) {
  const items = useQueries({ queries: props.ids.map(itemQuery) });
  const loaded = items.flatMap(({ data }) => (data ? [data] : []));
  if (loaded.length === 0) return null;
  return (
    <section className="just-added">
      <h2 className="label">just added</h2>
      <ul>
        {loaded.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => props.onOpen(item.id)}>
              <span className="just-title">{displayTitle(item)}</span>
              <span className="just-meta">
                {sourceOf(item)} · {formatShortDate(item.createdAt)}
                <StatusBadge item={item} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
