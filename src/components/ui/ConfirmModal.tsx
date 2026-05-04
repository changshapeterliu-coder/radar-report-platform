'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Button } from './button';

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  confirmVariant?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

/**
 * Semi-transparent modal backdrop + centered card with Title, body, and
 * Cancel/Confirm buttons. Closes on Esc / backdrop click / Cancel. Locks
 * body scroll while open.
 *
 * Design refs:
 * - ui-design-system.md sec 3.3 (card + shadow), sec 4.2 (button hierarchy)
 * - power design-guidelines.md sec 3.2 User Control
 */
export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  confirmVariant = 'primary',
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onCancel, busy]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="confirm-modal-title"
          className="mb-3 text-lg font-semibold text-foreground"
        >
          {title}
        </h2>
        <div className="text-sm leading-relaxed text-foreground-muted">
          {body}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant === 'danger' ? 'destructive' : 'default'}
            size="sm"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? '...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
