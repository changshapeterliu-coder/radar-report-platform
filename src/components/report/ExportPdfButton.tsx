'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ExportPdfButtonProps {
  /** Pre-derived, sanitized doc-title base used as the print dialog's default filename. */
  filenameBase: string;
}

/**
 * Export the on-screen report to PDF via the browser's native print dialog.
 *
 * No server round-trip: the already-rendered DOM is what prints, so the PDF
 * inherits full fidelity (badges, callouts, tables, Chinese line height). The
 * button is always `outline` — never `primary` (R5.4) — and surfaces busy /
 * error states (R10, R12).
 *
 * Filename is best-effort (R9): `document.title` is swapped to `filenameBase`
 * around the print call and restored on `afterprint`, which fires whether the
 * user saves or cancels the dialog (R9.4, R10.2).
 */
export function ExportPdfButton({ filenameBase }: ExportPdfButtonProps) {
  const { t } = useTranslation();
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const prevTitleRef = useRef<string | null>(null);

  // The authoritative reset: `afterprint` fires on both save and cancel, so it
  // restores the title and clears the busy state for every dialog outcome.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    function handleAfterPrint() {
      if (prevTitleRef.current !== null) {
        document.title = prevTitleRef.current;
        prevTitleRef.current = null;
      }
      setIsExporting(false);
    }

    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  function handleExport() {
    if (isExporting) return; // prevent concurrent activation (R10.1)
    if (typeof window === 'undefined') return; // SSR / non-browser guard

    setExportError(null); // clear stale error on next attempt
    setIsExporting(true); // busy within 1s (R12.1)

    try {
      prevTitleRef.current = document.title;
      document.title = filenameBase; // influence print dialog default filename (R9.1)
      window.print(); // open dialog, no server round-trip (R5.3, R12.2)
    } catch {
      // Restore title and re-enable for retry, surfacing a localized message (R9.4, R10.3)
      document.title = prevTitleRef.current ?? document.title;
      prevTitleRef.current = null;
      setIsExporting(false);
      setExportError(t('report.export.error'));
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handleExport}
        disabled={isExporting}
      >
        <Printer className="h-4 w-4" strokeWidth={1.75} />
        {isExporting ? t('report.export.preparing') : t('report.export.button')}
      </Button>
      {exportError && (
        <p className="text-xs text-danger-fg" role="alert">
          {exportError}
        </p>
      )}
    </div>
  );
}
