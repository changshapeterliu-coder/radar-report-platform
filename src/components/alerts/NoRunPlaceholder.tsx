'use client';

import { useTranslation } from 'react-i18next';
import { FileX } from 'lucide-react';

/**
 * Rendered in the detail pane when the selected day has no
 * daily_hot_topic_alerts row (whether the run failed or never ran).
 * Informational placeholder only.
 *
 * Design: matches the empty-state pattern used on /reports and /news —
 * dashed-border card with a lucide icon.
 */

export interface NoRunPlaceholderProps {
  date: string;
}

export function NoRunPlaceholder({ date }: NoRunPlaceholderProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
      <FileX
        className="mb-3 h-10 w-10 text-foreground-subtle"
        strokeWidth={1.5}
        aria-hidden
      />
      <p className="text-sm text-foreground-muted">{t('alerts.noRun')}</p>
      <p className="mt-1 font-mono text-xs text-foreground-subtle">{date}</p>
    </div>
  );
}
