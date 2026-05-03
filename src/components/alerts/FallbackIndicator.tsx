'use client';

import { useTranslation } from 'react-i18next';

/**
 * Small gray indicator rendered next to a field that fell back to the Chinese
 * source because the English translation was not (yet) populated.
 *
 * Spec: Requirement 8.11 — when `topic_name_en` / `summary_en` / canonical `_en`
 * fields are null/empty and the user's language is English, render the zh source
 * and append this indicator so the user knows why it's in Chinese.
 */
export function FallbackIndicator() {
  const { t } = useTranslation();
  return (
    <span className="ml-1.5 text-xs text-gray-500 align-middle">
      {t('alerts.fallback.chineseOriginal')}
    </span>
  );
}
