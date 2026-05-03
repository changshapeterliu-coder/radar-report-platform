'use client';

import { useEffect } from 'react';

export interface ToastState {
  kind: 'success' | 'error' | 'info';
  text: string;
}

export interface ToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
  durationMs?: number;
}

/**
 * Auto-dismissing inline toast. Positioned bottom-right. Does not queue;
 * a new toast simply replaces the current one.
 */
export function Toast({ toast, onDismiss, durationMs = 5000 }: ToastProps) {
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(t);
  }, [toast, durationMs, onDismiss]);

  if (!toast) return null;

  const classes =
    toast.kind === 'success'
      ? 'border-green-300 bg-green-50 text-green-700'
      : toast.kind === 'error'
        ? 'border-red-300 bg-red-50 text-red-700'
        : 'border-blue-300 bg-blue-50 text-blue-700';

  return (
    <div className="fixed bottom-6 right-6 z-50" role="status" aria-live="polite">
      <div className={`rounded border px-4 py-3 text-sm shadow-md ${classes}`}>{toast.text}</div>
    </div>
  );
}
