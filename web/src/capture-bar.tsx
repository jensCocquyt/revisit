import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ClipboardEvent, type DragEvent, type FormEvent, useEffect, useState } from "react";
import { type Capture, saveItem } from "./api";

export function CaptureBar() {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const preview = useObjectUrl(image);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: saveItem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });
  const link = image ? null : asLink(text);
  const canSave = (image !== null || text.trim().length > 0) && !save.isPending;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSave) return;
    const optionalNote = note.trim() || undefined;
    const capture: Capture = image
      ? { kind: "screenshot", image, note: optionalNote }
      : link
        ? { kind: "link", url: link, note: optionalNote }
        : { kind: "text", text, note: optionalNote };
    const [savedText, savedNote, savedImage] = [text, note, image];
    save.mutate(capture, {
      // Keep anything typed or attached while the save was in flight.
      onSuccess: () => {
        setText((current) => (current === savedText ? "" : current));
        setNote((current) => (current === savedNote ? "" : current));
        setImage((current) => (current === savedImage ? null : current));
      },
    });
  }

  function takeImage(files: FileList | null | undefined): boolean {
    const file = [...(files ?? [])].find((candidate) => candidate.type.startsWith("image/"));
    if (file) setImage(file);
    return file !== undefined;
  }

  return (
    <form
      className="capture"
      onSubmit={submit}
      onDragOver={(event: DragEvent) => event.preventDefault()}
      onDrop={(event: DragEvent) => {
        if (takeImage(event.dataTransfer.files)) event.preventDefault();
      }}
    >
      {preview ? (
        <div className="attached">
          <img src={preview} alt="Screenshot to save" />
          <button type="button" className="quiet" onClick={() => setImage(null)}>
            Remove
          </button>
        </div>
      ) : (
        <textarea
          aria-label="Something to save"
          placeholder="Paste or type something worth coming back to, or paste a screenshot"
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event: ClipboardEvent) => {
            if (takeImage(event.clipboardData.files)) event.preventDefault();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
          }}
        />
      )}
      <div className="capture-row">
        <input
          aria-label="Why you saved it"
          placeholder="Why you saved it (optional)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <label className="file-button">
          Screenshot
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => {
              takeImage(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <button type="submit" disabled={!canSave}>
          {save.isPending ? "Saving…" : image ? "Save screenshot" : link ? "Save link" : "Save"}
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

function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url;
}
