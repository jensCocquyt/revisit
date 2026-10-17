import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { saveItem } from "./api";

export function CaptureBar() {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: saveItem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });
  const canSave = text.trim().length > 0 && !save.isPending;
  const link = asLink(text);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSave) return;
    const optionalNote = note.trim() || undefined;
    const [savedText, savedNote] = [text, note];
    save.mutate(
      link
        ? { kind: "link", url: link, note: optionalNote }
        : { kind: "text", text, note: optionalNote },
      {
        // Keep anything typed while the save was in flight.
        onSuccess: () => {
          setText((current) => (current === savedText ? "" : current));
          setNote((current) => (current === savedNote ? "" : current));
        },
      },
    );
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
          {save.isPending ? "Saving…" : link ? "Save link" : "Save"}
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

// A single http(s) address on its own is saved as a link; anything else as text.
function asLink(text: string): string | null {
  const candidate = text.trim();
  if (!/^https?:\/\/\S+$/i.test(candidate)) return null;
  return URL.canParse(candidate) ? candidate : null;
}
