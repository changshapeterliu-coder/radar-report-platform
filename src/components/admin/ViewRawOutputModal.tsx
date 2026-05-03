'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface RawOutputRow {
  id: string;
  failure_reason: string | null;
  /**
   * raw_output is excluded from the runs list query for payload size. V1 MVP
   * shows only the failure_reason here; a follow-up spec can add a per-id
   * detail endpoint that includes the full raw_output field.
   */
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
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="raw-output-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[80vh] flex flex-col rounded-lg border border-gray-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 id="raw-output-title" className="text-base font-semibold text-[#232f3e]">
            {t('adminDailyAlert.runs.viewRaw.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-3">
          <p className="text-xs text-gray-500 font-mono">Run ID: {row.id}</p>

          {row.failure_reason && (
            <div>
              <p className="text-xs font-semibold text-red-700 mb-1">Failure Reason</p>
              <pre className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 whitespace-pre-wrap break-words">
                {row.failure_reason}
              </pre>
            </div>
          )}

          {row.raw_output ? (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-1">raw_output</p>
              <pre className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800 whitespace-pre-wrap break-words max-h-[50vh] overflow-auto">
                {row.raw_output}
              </pre>
            </div>
          ) : (
            !row.failure_reason && (
              <p className="text-sm text-gray-500 italic">
                {t('adminDailyAlert.runs.viewRaw.empty')}
              </p>
            )
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
          {hasContent && (
            <button
              type="button"
              onClick={handleCopy}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-[#232f3e] hover:bg-gray-50"
            >
              {copied
                ? t('adminDailyAlert.runs.viewRaw.copied')
                : t('adminDailyAlert.runs.viewRaw.copy')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-[#232f3e] px-3 py-1.5 text-xs font-medium text-white hover:bg-black"
          >
            {t('common.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
