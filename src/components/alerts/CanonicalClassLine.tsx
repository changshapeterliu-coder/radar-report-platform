'use client';

import { useTranslation } from 'react-i18next';
import { resolveText } from '@/lib/daily-alert/i18n-fallback';
import { FallbackIndicator } from './FallbackIndicator';

/**
 * "Class / 类别" supplementary line on each TopicCard.
 * Topics sharing a canonical_topic_key within the same day render this line
 * identically (shared-description invariant, Requirement 8.7).
 *
 * Design refs: ui-design-system.md sec 2.2 (leading-relaxed Chinese).
 */

export interface CanonicalClassLineProps {
  canonical: {
    canonical_topic_key: string;
    canonical_title_zh: string;
    canonical_title_en: string | null;
    canonical_description_zh: string;
    canonical_description_en: string | null;
  };
  lang: 'zh' | 'en';
}

export function CanonicalClassLine({
  canonical,
  lang,
}: CanonicalClassLineProps) {
  const { t } = useTranslation();
  const title = resolveText(
    canonical.canonical_title_zh,
    canonical.canonical_title_en,
    lang
  );
  const desc = resolveText(
    canonical.canonical_description_zh,
    canonical.canonical_description_en,
    lang
  );

  return (
    <div className="border-l-2 border-border-strong pl-3 py-0.5 text-sm text-foreground-muted">
      <div>
        <span className="font-medium text-foreground">
          {t('alerts.canonical.label')}
        </span>
        <span className="mx-1.5 text-foreground-subtle">·</span>
        <span>{title.text}</span>
        {title.needsFallbackIndicator && <FallbackIndicator />}
      </div>
      <p className="mt-0.5 leading-relaxed text-foreground-subtle">
        {desc.text}
        {desc.needsFallbackIndicator && <FallbackIndicator />}
      </p>
    </div>
  );
}
