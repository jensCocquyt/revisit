import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useEffectEvent, useId, useRef } from "react";
import { deleteItem, type Item, type SavedItem } from "./api";
import { asSentence } from "./format";
import { CloseIcon, PlusIcon } from "./icons";
import { refreshLists } from "./queries";

export function AddSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const { open, onOpenChange } = props;
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    if (!open && element?.open) element.close();
  }, [open]);

  return (
    <>
      <div className="add-band">
        <button type="button" className="save-button" onClick={() => onOpenChange(true)}>
          <PlusIcon />
          Add
        </button>
      </div>
      <dialog
        ref={dialog}
        className="sheet"
        aria-labelledby={titleId}
        onClose={() => onOpenChange(false)}
      >
        <div className="sheet-inner">
          <span className="sheet-handle" aria-hidden="true" />
          <header className="sheet-bar">
            <h2 id={titleId}>Add</h2>
            <button
              type="button"
              className="sheet-close"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
            >
              <CloseIcon />
            </button>
          </header>
          {props.children}
        </div>
      </dialog>
    </>
  );
}

export function SavedToast(props: {
  saved: SavedItem;
  onDone: () => void;
  onUndone: (id: string) => void;
}) {
  const { item, isNew } = props.saved;
  const queryClient = useQueryClient();
  const undo = useMutation({
    mutationFn: () => deleteItem(item.id),
    onSuccess: () => {
      props.onUndone(item.id);
      refreshLists(queryClient);
    },
  });
  const done = useEffectEvent(props.onDone);
  useEffect(() => {
    const timer = setTimeout(done, toastMs);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div role="status" className="toast">
      <span>
        {undo.error
          ? asSentence(undo.error.message)
          : isNew
            ? savedMessages[item.kind]
            : "Already saved."}
      </span>
      {isNew && (
        <button type="button" disabled={undo.isPending} onClick={() => undo.mutate()}>
          Undo
        </button>
      )}
    </div>
  );
}

const savedMessages: Record<Item["kind"], string> = {
  link: "Saved. Reading the page…",
  screenshot: "Saved. Reading the screenshot…",
  text: "Saved.",
};

const toastMs = 5000;
