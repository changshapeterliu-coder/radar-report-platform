'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface RawOutputRow {
  id: string;
  failure_reason: string | null;
  raw_output?: string | null;
}

export interface ViewRawOutputModalProps {
  row: RawOutputRow | null;
  onClose: () => void;
}

/**
 * Modal showing debug detail for a daily_alert_run row — failure_reason and
 * raw_output (if available). Backdrop click and Esc close. Locks body scroll
 * while open. Includes copy-to-clipboard.
 */
export function ViewRawOutputModal({ row, onClose }: ViewRawOutputModalProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!row) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [row, onClose]);

  if (!row) return null;

  const copyText = row.raw_output ?? row.failure_reason ?? '';
  const hasContent = Boolean(row.raw_output) || Boolean(row.failure_reason);

  const handleCopy = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore clipboard errors */
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="raw-output-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-card shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2
            id="raw-output-title"
            className="text-base font-semibold text-foreground"
          >
            {t('adminDailyAlert.runs.viewRaw.title')}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </header>

        <div className="flex-1 space-y-3 overflow-auto px-5 py-4">
          <p className="font-mono text-xs text-foreground-subtle">
            Run ID: {row.id}
          </p>

          {row.failure_reason && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-danger-fg">
                Failure Reason
              </p>
              <pre className="whitespace-pre-wrap break-words rounded-md border border-danger/20 bg-danger-bg px-3 py-2 text-xs text-danger-fg">
                {row.failure_reason}
              </pre>
            </div>
          )}

          {row.raw_output ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                raw_output
              </p>
              <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/60 px-3 py-2 text-xs text-foreground">
                {row.raw_output}
              </pre>
            </div>
          ) : (
            !row.failure_reason && (
              <p className="text-sm italic text-foreground-muted">
                {t('adminDailyAlert.runs.viewRaw.empty')}
              </p>
            )
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {hasContent && (
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied
                ? t('adminDailyAlert.runs.viewRaw.copied')
                : t('adminDailyAlert.runs.viewRaw.copy')}
            </Button>
          )}
          <Button size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </footer>
      </div>
    </div>
  );
}
