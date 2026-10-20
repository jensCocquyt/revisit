import { type ReactNode, useEffect, useId, useRef } from "react";
import { CloseIcon, PlusIcon } from "./icons";

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
