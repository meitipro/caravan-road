"use client";

// Modal sheet on top of the native <dialog>: focus trap, Escape and the backdrop come from the browser.
// Bottom sheet at phone width, centred card (or side drawer) from 768 px.

import { useEffect, useId, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  variant?: "sheet" | "drawer";
  tone?: "default" | "danger" | "success";
  footer?: ReactNode;
}

export function Sheet({ open, onClose, title, children, variant = "sheet", tone = "default", footer }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`sheet sheet-${variant} sheet-${tone}`}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="sheet-body">
          <header className="sheet-head">
            <h2 id={titleId} className="sheet-title">{title}</h2>
            <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
              <span aria-hidden="true">✕</span>
            </button>
          </header>
          <div className="sheet-content">{children}</div>
          {footer && <footer className="sheet-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
