'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flame } from 'lucide-react';
import { useRole } from '@/hooks/useRole';
import { resolveText } from '@/lib/daily-alert/i18n-fallback';
import { Button } from '@/components/ui/button';
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
 * Daily_Hot_Topic card.
 *
 * Design refs:
 * - ui-design-system.md sec 3.3 (card conventions), sec 4.4 (no emoji in chrome)
 * - power design-guidelines.md sec 5.2 Information Hierarchy, sec 5.3 Scannability
 *
 * Layout per Requirement 8.7:
 *   rank + topic_name (+ NoveltyBadge if is_new_canonical)
 *   CanonicalClassLine
 *   hot_score chip (Flame icon — migrated from emoji)
 *   keywords (inline, comma-separated)
 *   summary (language-resolved)
 *   sample_quotes (2-3 blockquotes)
 *   source_links (3-10 external links)
 *   admin-only: "Re-translate topic" button
 */
export function TopicCard({ topic, lang }: TopicCardProps) {
  const { t } = useTranslation();
  const { isAdmin } = useRole();
  const [retranslating, setRetranslating] = useState<
    null | 'pending' | 'success' | 'error'
  >(null);

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
    <article className="rounded-lg border border-border bg-card p-5 shadow-sm">
      {/* Header: rank + topic_name + NoveltyBadge */}
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background"
            aria-label={`${t('alerts.topic.rank')} ${topic.rank}`}
          >
            {topic.rank}
          </span>
          <h3 className="min-w-0 text-base font-semibold leading-snug text-foreground">
            <span className="break-words">{name.text}</span>
            {name.needsFallbackIndicator && <FallbackIndicator />}
            {topic.is_new_canonical && <NoveltyBadge />}
          </h3>
        </div>

        {/* Hot score chip (Flame icon replaces emoji) */}
        <span
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-primary/20 bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary"
          aria-label={t('alerts.topic.hotScore')}
        >
          <Flame className="h-3 w-3" strokeWidth={2} aria-hidden />
          {topic.hot_score}
        </span>
      </header>

      {/* Canonical class line */}
      <div className="mb-4">
        <CanonicalClassLine canonical={topic.canonical} lang={lang} />
      </div>

      {/* Keywords */}
      {topic.keywords.length > 0 && (
        <div className="mb-3 text-sm">
          <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            {t('alerts.topic.keywords')}
          </span>
          <span className="text-foreground">{topic.keywords.join('、')}</span>
        </div>
      )}

      {/* Summary */}
      <div className="mb-4 text-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          {t('alerts.topic.summary')}
        </p>
        <p className="leading-relaxed text-foreground">
          {summary.text}
          {summary.needsFallbackIndicator && <FallbackIndicator />}
        </p>
      </div>

      {/* Sample quotes */}
      {topic.sample_quotes.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
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
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          {t('alerts.topic.sourceLinks')}
        </p>
        <SourceLinkList links={topic.source_links} />
      </div>

      {/* Admin actions */}
      {isAdmin && (
        <div className="mt-4 flex items-center gap-3 border-t border-border pt-3">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={handleReTranslate}
            disabled={retranslating === 'pending'}
          >
            {retranslating === 'pending' ? '…' : t('alerts.topic.reTranslate')}
          </Button>
          {retranslating === 'success' && (
            <span className="text-xs text-success-fg">
              {t('alerts.topic.reTranslateSuccess')}
            </span>
          )}
          {retranslating === 'error' && (
            <span className="text-xs text-danger-fg">
              {t('alerts.topic.reTranslateError')}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
