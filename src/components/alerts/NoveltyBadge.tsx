'use client';

import { useTranslation } from 'react-i18next';

/**
 * Small red "新" / "NEW" chip rendered next to a topic name when the topic's
 * canonical_topic_key is brand-new (is_new_canonical=true). Used both in the
 * overview table's Top-Topic Preview cell and in the TopicCard header.
 *
 * Spec: Requirement 8.4, 8.7 — visual "new" signal for first-seen canonicals.
 */
export function NoveltyBadge() {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 border border-red-200 ml-1.5"
      aria-label={t('alerts.novelty.aria')}
    >
      {t('alerts.novelty.label')}
    </span>
  );
}
