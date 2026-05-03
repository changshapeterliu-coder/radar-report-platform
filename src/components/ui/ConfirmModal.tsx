'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';

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
 * Semi-transparent modal backdrop + centered card with Title, body content,
 * and Cancel / Confirm buttons. Closes on:
 *   - Esc key
 *   - Backdrop click
 *   - Cancel button
 *
 * Locks body scroll while open. Used by TriggerDailyNowButton, RetryButton,
 * and the "Reset to default" flow in DailyPromptEditor.
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

  const confirmClass =
    confirmVariant === 'danger'
      ? 'bg-red-600 hover:bg-red-700 text-white'
      : 'bg-[#ff9900] hover:bg-[#e88b00] text-white';

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-modal-title" className="text-lg font-semibold text-[#232f3e] mb-3">
          {title}
        </h2>
        <div className="text-sm text-gray-600">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-[#232f3e] hover:bg-gray-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded px-4 py-1.5 text-sm font-medium disabled:opacity-50 ${confirmClass}`}
          >
            {busy ? '...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
