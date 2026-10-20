import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type ClipboardEvent,
  type Dispatch,
  type DragEvent,
  type FormEvent,
  type SetStateAction,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { type Capture, type SavedItem, saveItem } from "./api";
import { asSentence, formatBytes, modifierKey } from "./format";
import { AlertIcon } from "./icons";
import { isEditable } from "./shortcuts";

export function AddForm(props: {
  draft: Draft;
  onDraft: Dispatch<SetStateAction<Draft>>;
  onSaved: (saved: SavedItem) => void;
  inSheet?: boolean;
}) {
  const { draft, onDraft, onSaved, inSheet = false } = props;
  const textArea = useRef<HTMLTextAreaElement>(null);
  const [fileProblem, setFileProblem] = useState<Problem | null>(null);
  const preview = useObjectUrl(draft.image);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: saveItem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });
  const link = draft.image ? null : asLink(draft.text);
  const canSave = (draft.image !== null || draft.text.trim() !== "") && !save.isPending;
  const problem = fileProblem ?? (save.error && saveProblem(save.error, save.variables));

  function update(change: Partial<Draft>) {
    onDraft((current) => ({ ...current, ...change }));
    setFileProblem(null);
    if (save.isError) save.reset();
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSave) return;
    const note = draft.note.trim() || undefined;
    const capture: Capture = draft.image
      ? { kind: "screenshot", image: draft.image, note }
      : link
        ? { kind: "link", url: link, note }
        : { kind: "text", text: draft.text, note };
    const saved = draft;
    save.mutate(capture, {
      onSuccess: (result) => {
        // Keep anything typed or attached while the save was in flight.
        onDraft((current) => ({
          text: current.text === saved.text ? "" : current.text,
          note: current.note === saved.note ? "" : current.note,
          image: current.image === saved.image ? null : current.image,
        }));
        onSaved(result);
      },
    });
  }

  function takeFile(files: Iterable<File>): boolean {
    const [file] = files;
    if (!file) return false;
    if (file.type.startsWith("image/")) {
      update({ image: file });
    } else {
      setFileProblem({ title: `Can’t save ${file.name}`, detail: "Only images can be saved." });
    }
    return true;
  }

  function takeText(text: string) {
    update({ text: draft.text ? `${draft.text}\n${text}` : text });
    textArea.current?.focus();
  }

  async function pasteFromClipboard() {
    try {
      for (const entry of (await navigator.clipboard.read?.()) ?? []) {
        const type = entry.types.find((candidate) => candidate.startsWith("image/"));
        if (type) {
          const blob = await entry.getType(type);
          takeFile([new File([blob], `pasted.${type.slice("image/".length)}`, { type })]);
          return;
        }
      }
      const text = await navigator.clipboard.readText();
      if (text) takeText(text);
    } catch {
      setFileProblem({
        title: "Can’t read the clipboard",
        detail: "Allow clipboard access, or paste into the box.",
      });
    }
  }

  const onPagePaste = useEffectEvent((event: globalThis.ClipboardEvent) => {
    if (isEditable(event.target) || document.querySelector("dialog:modal")) return;
    const data = event.clipboardData;
    if (!data) return;
    const text = data.getData("text");
    if (takeFile(data.files)) event.preventDefault();
    else if (text.trim()) {
      takeText(text);
      event.preventDefault();
    }
  });
  useEffect(() => {
    if (inSheet) return;
    document.addEventListener("paste", onPagePaste);
    return () => document.removeEventListener("paste", onPagePaste);
  }, [inSheet]);

  return (
    <form
      className="add-form"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          submit();
        }
      }}
      onDragOver={(event: DragEvent) => event.preventDefault()}
      onDrop={(event: DragEvent) => {
        if (takeFile(event.dataTransfer.files)) event.preventDefault();
      }}
    >
      {!inSheet && <h2 className="add-label">Add</h2>}
      {preview && draft.image ? (
        <div className="attached">
          <img src={preview} alt="Screenshot to save" />
          <div className="attached-row">
            <span className="attached-name">
              {draft.image.name} · {formatBytes(draft.image.size)}
            </span>
            <button type="button" className="rail-button" onClick={() => update({ image: null })}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <textarea
          ref={textArea}
          aria-label="Link, text or screenshot"
          className="add-input"
          rows={inSheet ? 3 : 5}
          placeholder={
            inSheet
              ? "Paste a link, text or screenshot"
              : "Paste or drop a link, text or screenshot"
          }
          value={draft.text}
          onChange={(event) => update({ text: event.target.value })}
          onPaste={(event: ClipboardEvent) => {
            if (takeFile(event.clipboardData.files)) event.preventDefault();
          }}
        />
      )}
      {link && (
        <p className="add-kind">
          <span className="badge" data-tone="info">
            Link
          </span>
          {new URL(link).hostname}
        </p>
      )}
      {problem && (
        <div role="alert" className="add-problem">
          <AlertIcon />
          <div>
            <strong>{problem.title}</strong>
            <span>{problem.detail}</span>
          </div>
        </div>
      )}
      <input
        aria-label="Why you saved it"
        className="add-note"
        placeholder="Why? (optional)"
        value={draft.note}
        onChange={(event) => update({ note: event.target.value })}
      />
      {inSheet && (
        <div className="add-sources">
          {canReadClipboard && (
            <button type="button" className="rail-button" onClick={pasteFromClipboard}>
              Paste
            </button>
          )}
          <label className="rail-button file-button">
            Choose screenshot
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(event) => {
                takeFile(event.target.files ?? []);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      )}
      <button
        type="submit"
        className="save-button"
        disabled={!canSave}
        aria-keyshortcuts={inSheet ? undefined : "Control+Enter Meta+Enter"}
      >
        {save.isPending ? "Saving…" : draft.image ? "Save screenshot" : link ? "Save link" : "Save"}
        {!inSheet && (
          <span className="key" aria-hidden="true">
            {modifierKey} ↵
          </span>
        )}
      </button>
    </form>
  );
}

export type Draft = { text: string; note: string; image: File | null };

export const emptyDraft: Draft = { text: "", note: "", image: null };

type Problem = { title: string; detail: string };

function saveProblem(error: Error, capture: Capture | undefined): Problem {
  return {
    title: capture?.kind === "screenshot" ? `Can’t save ${capture.image.name}` : "Can’t save this",
    detail: asSentence(error.message),
  };
}

// A single http(s) address on its own is saved as a link; anything else as text.
function asLink(text: string): string | null {
  const candidate = text.trim();
  if (!/^https?:\/\/\S+$/i.test(candidate)) return null;
  return URL.canParse(candidate) ? candidate : null;
}

const canReadClipboard = typeof navigator.clipboard?.readText === "function";

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
