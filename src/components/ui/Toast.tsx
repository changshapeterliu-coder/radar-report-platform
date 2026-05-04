'use client';

import { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

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
 * a new toast replaces the current one.
 *
 * Design: ui-design-system.md sec 1.3 (semantic tokens).
 */
export function Toast({ toast, onDismiss, durationMs = 5000 }: ToastProps) {
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(t);
  }, [toast, durationMs, onDismiss]);

  if (!toast) return null;

  const palette =
    toast.kind === 'success'
      ? {
          Icon: CheckCircle2,
          classes: 'border-success/20 bg-success-bg text-success-fg',
        }
      : toast.kind === 'error'
        ? {
            Icon: AlertCircle,
            classes: 'border-danger/20 bg-danger-bg text-danger-fg',
          }
        : {
            Icon: Info,
            classes: 'border-info/20 bg-info-bg text-info-fg',
          };

  return (
    <div
      className="fixed bottom-6 right-6 z-50"
      role="status"
      aria-live="polite"
    >
      <div
        className={cn(
          'flex items-start gap-2 rounded-md border px-4 py-3 text-sm shadow-md',
          palette.classes
        )}
      >
        <palette.Icon
          className="mt-0.5 h-4 w-4 flex-shrink-0"
          strokeWidth={1.75}
          aria-hidden
        />
        <span>{toast.text}</span>
      </div>
    </div>
  );
}
