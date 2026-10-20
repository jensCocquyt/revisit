import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { deleteItem, type ItemDetail, imageUrl, retryItem } from "./api";
import { asSentence, displayTitle, formatSavedAt, isTitledByUrl } from "./format";
import { BackIcon, CloseIcon } from "./icons";
import { itemQuery, refreshLists } from "./queries";
import { StatusBadge } from "./status-badge";
import type { Layout } from "./use-layout";

export function ItemPanel(props: {
  id: string;
  layout: Layout;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const { id, layout } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const { data: item, error } = useQuery(itemQuery(id));

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const close = () => dialog.current?.close();
  return (
    <dialog
      ref={dialog}
      className="panel"
      onClose={props.onClose}
      aria-label={item ? displayTitle(item) : "Item"}
    >
      <div className="panel-inner">
        <header className="panel-bar">
          {layout === "phone" ? (
            <>
              <button type="button" className="back-button" onClick={close}>
                <BackIcon />
                Results
              </button>
              <span className="panel-kind">{item?.kind}</span>
            </>
          ) : (
            <>
              <span className="panel-kind">{item?.kind}</span>
              {item && <StatusBadge item={item} />}
              <button type="button" className="close-button" aria-label="Close" onClick={close}>
                <kbd>Esc</kbd>
                <CloseIcon />
              </button>
            </>
          )}
        </header>
        {error && (
          <p role="alert" className="panel-body listing-error">
            {error.message}
          </p>
        )}
        {item && (
          <ItemBody
            item={item}
            layout={layout}
            onDeleted={() => {
              props.onDeleted(id);
              close();
            }}
          />
        )}
      </div>
    </dialog>
  );
}

function ItemBody(props: { item: ItemDetail; layout: Layout; onDeleted: () => void }) {
  const { item } = props;
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => retryItem(item.id),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const remove = useMutation({
    mutationFn: () => deleteItem(item.id),
    onSuccess: () => {
      props.onDeleted();
      refreshLists(queryClient);
    },
  });
  const actionError = retry.error ?? remove.error;

  return (
    <div className="panel-body">
      <div className="panel-heading">
        {props.layout === "phone" && <StatusBadge item={item} />}
        <h2 className="panel-title" data-mono={isTitledByUrl(item) || undefined}>
          {displayTitle(item)}
        </h2>
        <span className="panel-saved">Saved {formatSavedAt(item.createdAt)}</span>
      </div>
      {item.note && (
        <p className="why">
          <span className="label">why</span>
          {item.note}
        </p>
      )}
      {item.url && (
        <div className="source">
          <span className="source-url">{item.url}</span>
          <a href={item.url} target="_blank" rel="noreferrer">
            Open ↗
          </a>
        </div>
      )}
      {item.kind === "screenshot" && <Screenshot item={item} />}
      {item.error && (
        <div
          role={item.status === "failed" ? "alert" : "status"}
          className="notice"
          data-tone={item.status === "failed" ? "danger" : "warn"}
        >
          <strong>
            {item.status === "failed"
              ? `Couldn’t read this ${readableKind[item.kind]}`
              : "The page couldn’t be read"}
          </strong>
          <span className="notice-text">
            {asSentence(item.error)}
            {item.status !== "failed" &&
              " The link is still saved, and search finds it by its URL and your note."}
          </span>
          <button
            type="button"
            className="notice-button"
            onClick={() => retry.mutate()}
            disabled={retry.isPending}
          >
            {retry.isPending ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}
      {item.body &&
        (item.kind === "screenshot" ? (
          <section className="read-text">
            <h3 className="label">read from the image</h3>
            <p>{item.body}</p>
          </section>
        ) : (
          <div className="panel-text">{item.body}</div>
        ))}
      <footer className="panel-actions">
        <DeleteControl pending={remove.isPending} onDelete={() => remove.mutate()} />
      </footer>
      {actionError && (
        <p role="alert" className="listing-error">
          {asSentence(actionError.message)}
        </p>
      )}
    </div>
  );
}

function Screenshot({ item }: { item: ItemDetail }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <div className="no-preview">No preview</div>;
  return (
    <img
      className="panel-image"
      src={imageUrl(item.id)}
      alt={`Screenshot: ${displayTitle(item)}`}
      onError={() => setBroken(true)}
    />
  );
}

function DeleteControl(props: { pending: boolean; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) cancel.current?.focus();
  }, [confirming]);

  if (!confirming) {
    return (
      <button type="button" className="delete-button" onClick={() => setConfirming(true)}>
        Delete
      </button>
    );
  }
  return (
    <div className="confirm">
      <span role="alert" className="confirm-text">
        Delete this item? This can’t be undone.
      </span>
      <button
        ref={cancel}
        type="button"
        className="outline-button"
        onClick={() => setConfirming(false)}
      >
        Cancel
      </button>
      <button
        type="button"
        className="danger-button"
        disabled={props.pending}
        onClick={props.onDelete}
      >
        Delete
      </button>
    </div>
  );
}

const readableKind: Record<ItemDetail["kind"], string> = {
  text: "text",
  link: "page",
  screenshot: "screenshot",
};
