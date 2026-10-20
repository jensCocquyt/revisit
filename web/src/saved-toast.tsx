import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";
import { deleteItem, type Item, type SavedItem } from "./api";
import { asSentence } from "./format";
import { refreshLists } from "./queries";

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
