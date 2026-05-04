'use client';

import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import { resolveText } from '@/lib/daily-alert/i18n-fallback';
import { FallbackIndicator } from './FallbackIndicator';

/**
 * Rendered in the detail pane when the selected day produced an Empty_Day_Alert:
 * pipeline ran successfully but found zero qualifying topics. Shows the
 * `empty_day_message_*` in the user's language, falling back to Chinese if
 * English is not yet translated (Requirement 6.5).
 *
 * Design refs: ui-design-system.md sec 1.3 (success semantic), sec 3.3
 * (card conventions).
 */

export interface EmptyDayDisplayProps {
  alert: {
    id: string;
    published_at: string;
    empty_day_message_zh: string | null;
    empty_day_message_en: string | null;
  };
  lang: 'zh' | 'en';
}

export function EmptyDayDisplay({ alert, lang }: EmptyDayDisplayProps) {
  const { t } = useTranslation();
  const message = resolveText(
    alert.empty_day_message_zh,
    alert.empty_day_message_en,
    lang
  );
  const publishedAt = new Date(alert.published_at);
  const publishedLabel = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(publishedAt);

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card px-6 py-16 text-center">
      <CheckCircle2
        className="mb-3 h-10 w-10 text-success"
        strokeWidth={1.5}
        aria-hidden
      />
      <p className="max-w-md text-sm leading-relaxed text-foreground">
        {message.text}
        {message.needsFallbackIndicator && <FallbackIndicator />}
      </p>
      <p className="mt-3 text-xs text-foreground-subtle">
        {t('alerts.status.published')} · {publishedLabel} CST
      </p>
    </div>
  );
}
