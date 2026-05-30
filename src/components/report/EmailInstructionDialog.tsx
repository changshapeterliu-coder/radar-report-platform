'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface EmailInstructionDialogProps {
  reportId: string;
  title: string;
  onClose: () => void;
}

/**
 * Dialog that hands a published report to the `send-report-email` Kiro skill.
 *
 * Shows a fixed Chinese instruction snippet (report id + title substituted in)
 * and a single primary copy control. The admin copies it and pastes it into
 * Kiro to start the skill — the platform never sends an email itself.
 *
 * Mirrors the platform's hand-rolled modal idiom (ViewRawOutputModal):
 * fixed overlay, backdrop click + Esc close, body-scroll lock, role="dialog"
 * + aria-modal, and the copied-state confirmation pattern. The snippet body is
 * an instruction to the skill, not UI chrome, so it stays a fixed Chinese
 * string; only the dialog chrome goes through t().
 */
export function EmailInstructionDialog({
  reportId,
  title,
  onClose,
}: EmailInstructionDialogProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
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
  }, [onClose]);

  // Fixed Chinese instruction to the skill — not translated.
  const snippet = `用 send-report-email skill 把报告 ${reportId}（${title}）发邮件出去，收件人默认 radar-report-ah@amazon.com，其他收件人我待会儿告诉你`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can reject (permissions, insecure context). Swallow the
      // error and leave the snippet visible/selectable so the admin can copy
      // it manually — no hard error surfaced.
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-instruction-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-border bg-card shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2
            id="email-instruction-title"
            className="text-base font-semibold text-foreground"
          >
            {t('reports.emailReport.dialogTitle')}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t('reports.emailReport.close')}
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </header>

        <div className="flex-1 space-y-3 overflow-auto px-5 py-4">
          <p className="text-sm text-foreground-muted">
            {t('reports.emailReport.dialogHint')}
          </p>
          <pre className="select-text whitespace-pre-wrap break-words rounded-md border border-border bg-muted/60 px-3 py-3 text-sm leading-relaxed text-foreground">
            {snippet}
          </pre>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button onClick={handleCopy} size="sm">
            {copied ? (
              <>
                <Check className="h-4 w-4" strokeWidth={1.75} />
                {t('reports.emailReport.copied')}
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" strokeWidth={1.75} />
                {t('reports.emailReport.copy')}
              </>
            )}
          </Button>
        </footer>
      </div>
    </div>
  );
}
