'use client';

import { useTranslation } from 'react-i18next';

export interface NoRunPlaceholderProps {
  date: string;
}

/**
 * Rendered in the detail pane when the selected day has no daily_hot_topic_alerts
 * row (whether the run failed or never ran). Informational placeholder only.
 */
export function NoRunPlaceholder({ date }: NoRunPlaceholderProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white py-16 px-6 text-center">
      <div className="mb-3 text-3xl text-gray-300" aria-hidden="true">
        ∅
      </div>
      <p className="text-sm text-gray-600">{t('alerts.noRun')}</p>
      <p className="mt-1 text-xs text-gray-400 font-mono">{date}</p>
    </div>
  );
}
