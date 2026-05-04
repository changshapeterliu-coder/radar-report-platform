'use client';

import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

/**
 * Small "新" / "NEW" chip rendered next to a topic name when the topic's
 * canonical_topic_key is brand-new (is_new_canonical=true). Used both in the
 * overview table's Top-Topic Preview cell and in the TopicCard header.
 *
 * Spec: Requirement 8.4, 8.7 — visual "new" signal for first-seen canonicals.
 *
 * Visual: uses the Badge primitive (danger variant) — matches the "hot/new"
 * semantic intent without reinventing color tokens. A wrapper span adds the
 * left margin so it composes inside inline h3 content.
 */
export function NoveltyBadge() {
  const { t } = useTranslation();
  return (
    <span className="ml-1.5 inline-block align-middle">
      <Badge variant="danger" aria-label={t('alerts.novelty.aria')}>
        {t('alerts.novelty.label')}
      </Badge>
    </span>
  );
}
