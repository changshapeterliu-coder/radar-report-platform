'use client';

import { useTranslation } from 'react-i18next';
import { resolveText } from '@/lib/daily-alert/i18n-fallback';
import { FallbackIndicator } from './FallbackIndicator';

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

/**
 * Renders the "Class / 类别" supplementary line on each TopicCard.
 * Topics sharing a canonical_topic_key within the same day render this line
 * identically (shared-description invariant, Requirement 8.7).
 */
export function CanonicalClassLine({ canonical, lang }: CanonicalClassLineProps) {
  const { t } = useTranslation();
  const title = resolveText(canonical.canonical_title_zh, canonical.canonical_title_en, lang);
  const desc = resolveText(
    canonical.canonical_description_zh,
    canonical.canonical_description_en,
    lang
  );

  return (
    <div className="text-sm text-gray-600 border-l-2 border-gray-300 pl-3 py-0.5">
      <div>
        <span className="font-medium text-[#232f3e]">{t('alerts.canonical.label')}</span>
        <span className="mx-1.5 text-gray-400">·</span>
        <span>{title.text}</span>
        {title.needsFallbackIndicator && <FallbackIndicator />}
      </div>
      <p className="mt-0.5 text-gray-500 leading-relaxed">
        {desc.text}
        {desc.needsFallbackIndicator && <FallbackIndicator />}
      </p>
    </div>
  );
}
