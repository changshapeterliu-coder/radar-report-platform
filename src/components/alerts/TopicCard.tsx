'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRole } from '@/hooks/useRole';
import { resolveText } from '@/lib/daily-alert/i18n-fallback';
import type { DailyHotTopicFull } from '@/types/daily-alert';
import { NoveltyBadge } from './NoveltyBadge';
import { FallbackIndicator } from './FallbackIndicator';
import { CanonicalClassLine } from './CanonicalClassLine';
import { SampleQuote } from './SampleQuote';
import { SourceLinkList } from './SourceLinkList';

export interface TopicCardProps {
  topic: DailyHotTopicFull;
  lang: 'zh' | 'en';
}

/**
 * Renders a single Daily_Hot_Topic. Per Requirement 8.7 the layout is:
 *   rank + topic_name (+ NoveltyBadge if is_new_canonical)
 *   CanonicalClassLine
 *   hot_score chip
 *   keywords (inline, comma-separated)
 *   summary (language-resolved, with (Chinese original) indicator if fallen back)
 *   sample_quotes (2-3 blockquotes)
 *   source_links (3-10 external links)
 *   admin-only: "Re-translate topic" button (gated by useRole().isAdmin)
 */
export function TopicCard({ topic, lang }: TopicCardProps) {
  const { t } = useTranslation();
  const { isAdmin } = useRole();
  const [retranslating, setRetranslating] = useState<null | 'pending' | 'success' | 'error'>(null);

  const name = resolveText(topic.topic_name_zh, topic.topic_name_en, lang);
  const summary = resolveText(topic.summary_zh, topic.summary_en, lang);

  const handleReTranslate = async () => {
    setRetranslating('pending');
    try {
      const res = await fetch(
        `/api/admin/alerts/${encodeURIComponent(topic.id)}/re-translate-topic`,
        { method: 'POST' }
      );
      if (res.status === 202) {
        setRetranslating('success');
      } else {
        setRetranslating('error');
      }
    } catch {
      setRetranslating('error');
    } finally {
      window.setTimeout(() => setRetranslating(null), 4000);
    }
  };

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      {/* Header: rank + topic_name + NoveltyBadge */}
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span
            className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#232f3e] text-sm font-bold text-white"
            aria-label={`${t('alerts.topic.rank')} ${topic.rank}`}
          >
            {topic.rank}
          </span>
          <h3 className="text-base font-semibold text-[#232f3e] leading-snug min-w-0">
            <span className="break-words">{name.text}</span>
            {name.needsFallbackIndicator && <FallbackIndicator />}
            {topic.is_new_canonical && <NoveltyBadge />}
          </h3>
        </div>

        {/* Hot score chip */}
        <span
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-orange-700"
          aria-label={t('alerts.topic.hotScore')}
        >
          🔥 {topic.hot_score}
        </span>
      </header>

      {/* Canonical class line */}
      <div className="mb-4">
        <CanonicalClassLine canonical={topic.canonical} lang={lang} />
      </div>

      {/* Keywords */}
      {topic.keywords.length > 0 && (
        <div className="mb-3 text-sm">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-2">
            {t('alerts.topic.keywords')}
          </span>
          <span className="text-gray-700">{topic.keywords.join('、')}</span>
        </div>
      )}

      {/* Summary */}
      <div className="mb-4 text-sm">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          {t('alerts.topic.summary')}
        </p>
        <p className="text-gray-700 leading-relaxed">
          {summary.text}
          {summary.needsFallbackIndicator && <FallbackIndicator />}
        </p>
      </div>

      {/* Sample quotes */}
      {topic.sample_quotes.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            {t('alerts.topic.sampleQuotes')}
          </p>
          <div className="space-y-2">
            {topic.sample_quotes.map((quote, idx) => (
              <SampleQuote key={idx} quote={quote} />
            ))}
          </div>
        </div>
      )}

      {/* Source links */}
      <div className={isAdmin ? 'mb-4' : ''}>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          {t('alerts.topic.sourceLinks')}
        </p>
        <SourceLinkList links={topic.source_links} />
      </div>

      {/* Admin actions */}
      {isAdmin && (
        <div className="mt-4 flex items-center gap-3 border-t border-gray-100 pt-3">
          <button
            type="button"
            onClick={handleReTranslate}
            disabled={retranslating === 'pending'}
            className="rounded border border-[#146eb4] px-3 py-1 text-xs font-medium text-[#146eb4] hover:bg-blue-50 disabled:opacity-50"
          >
            {retranslating === 'pending' ? '...' : t('alerts.topic.reTranslate')}
          </button>
          {retranslating === 'success' && (
            <span className="text-xs text-green-600">
              {t('alerts.topic.reTranslateSuccess')}
            </span>
          )}
          {retranslating === 'error' && (
            <span className="text-xs text-red-600">{t('alerts.topic.reTranslateError')}</span>
          )}
        </div>
      )}
    </article>
  );
}
