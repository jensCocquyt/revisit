import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { deleteItem, getItem, imageUrl, isInProgress, retryItem } from "./api";
import { describeStatus, displayTitle, formatSavedAt, kindLabels } from "./format";

export function ItemPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const { data: item, error } = useQuery({
    queryKey: ["item", id],
    queryFn: () => getItem(id),
    refetchInterval: (query) => (query.state.data && isInProgress(query.state.data) ? 1500 : false),
  });
  const retry = useMutation({
    mutationFn: () => retryItem(id),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const remove = useMutation({
    mutationFn: () => deleteItem(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      onClose();
    },
  });

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const status = item && describeStatus(item);
  return (
    <dialog
      ref={dialog}
      className="panel"
      onClose={onClose}
      aria-label={item ? displayTitle(item) : "Item"}
    >
      <header className="panel-header">
        <h2>{item ? displayTitle(item) : "Loading…"}</h2>
        <button type="button" className="quiet" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      {error && <p className="error">{error.message}</p>}
      {item && (
        <>
          <p className="item-meta">
            {kindLabels[item.kind]} · saved {formatSavedAt(item.createdAt)}
            {status && (
              <span className={`status${item.error ? " status-error" : ""}`}>{status}</span>
            )}
          </p>
          {item.note && <p className="note">{item.note}</p>}
          {item.error && <p className="error">{item.error}</p>}
          {item.url && (
            <a className="source" href={item.url} target="_blank" rel="noreferrer">
              {item.url}
            </a>
          )}
          {item.kind === "screenshot" && (
            <img className="screenshot" src={imageUrl(item.id)} alt={displayTitle(item)} />
          )}
          {item.body && <div className="body">{item.body}</div>}
          <footer className="panel-actions">
            {item.error && (
              <button type="button" onClick={() => retry.mutate()} disabled={retry.isPending}>
                Retry
              </button>
            )}
            <button
              type="button"
              className="danger"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm("Delete this item?")) remove.mutate();
              }}
            >
              Delete
            </button>
          </footer>
          {(retry.error ?? remove.error) && (
            <p role="alert" className="error">
              {(retry.error ?? remove.error)?.message}
            </p>
          )}
        </>
      )}
    </dialog>
  );
}
