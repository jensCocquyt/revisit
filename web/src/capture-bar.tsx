import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { saveItem } from "./api";

export function CaptureBar() {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: saveItem,
    onSuccess: () => {
      setText("");
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });
  const canSave = text.trim().length > 0 && !save.isPending;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (canSave) save.mutate({ kind: "text", text, note: note.trim() || undefined });
  }

  return (
    <form className="capture" onSubmit={submit}>
      <textarea
        aria-label="Something to save"
        placeholder="Paste or type something worth coming back to"
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
        }}
      />
      <div className="capture-row">
        <input
          aria-label="Why you saved it"
          placeholder="Why you saved it (optional)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <button type="submit" disabled={!canSave}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
      {save.error && (
        <p role="alert" className="error">
          {save.error.message}
        </p>
      )}
    </form>
  );
}
