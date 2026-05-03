'use client';

import { useTranslation } from 'react-i18next';
import { resolveText } from '@/lib/daily-alert/i18n-fallback';
import { FallbackIndicator } from './FallbackIndicator';

export interface EmptyDayDisplayProps {
  alert: {
    id: string;
    published_at: string;
    empty_day_message_zh: string | null;
    empty_day_message_en: string | null;
  };
  lang: 'zh' | 'en';
}

/**
 * Rendered in the detail pane when the selected day produced an Empty_Day_Alert:
 * pipeline ran successfully but found zero qualifying topics. Shows the
 * `empty_day_message_*` in the user's language, falling back to Chinese if
 * English is not yet translated (Requirement 6.5).
 */
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
    <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-white py-16 px-6 text-center">
      <div
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-2xl text-green-500"
        aria-hidden="true"
      >
        ✓
      </div>
      <p className="text-sm text-gray-700 max-w-md leading-relaxed">
        {message.text}
        {message.needsFallbackIndicator && <FallbackIndicator />}
      </p>
      <p className="mt-3 text-xs text-gray-400">
        {t('alerts.status.published')} · {publishedLabel} CST
      </p>
    </div>
  );
}
