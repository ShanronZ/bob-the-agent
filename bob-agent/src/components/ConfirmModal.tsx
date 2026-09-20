import { useEffect } from "react";

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Replaces window.confirm() for destructive actions (reset, load demo
// meeting) — a native browser dialog looks and feels like an error, not
// part of the product, which undercuts everything else here being styled
// to EF's brand. Escape and a backdrop click both cancel.
export function ConfirmModal({ open, title, message, confirmLabel = "Confirm", danger, onConfirm, onCancel }: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-panel" role="alertdialog" aria-modal="true" aria-labelledby="modal-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="modal-title">{title}</h2>
        <p className="muted small">{message}</p>
        <div className="modal-actions">
          <button type="button" className="action-btn action-btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`action-btn ${danger ? "action-btn--danger" : ""}`} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
