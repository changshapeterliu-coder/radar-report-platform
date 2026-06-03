'use client';

import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { TopTopic } from '@/types/report';
import type { CategoryCellState } from './TopTopicsTable';

/**
 * CompactTopTopicsTable — dashboard variant of `TopTopicsTable`.
 *
 * Why a separate component:
 *   The report-detail page (/reports/[id]) shows the full 7-column table
 *   (Rank / Topic / Category / Voice / Keywords / Seller Discussion /
 *   Severity) so users can inspect a topic without leaving the page. The
 *   dashboard is the opposite — a glance + drill-in surface — and the full
 *   table compresses keywords + seller discussion into multi-line "noodles"
 *   inside the narrow main column. This component drops Keywords + Seller
 *   Discussion entirely (they live on the report-detail page) and folds
 *   Category into the Topic cell as a secondary line.
 *
 * Columns (fixed layout):
 *   Rank  | Topic (+ canonical category)  | Heat
 *
 * The `Heat` column renders `severity` as a categorical pill (高/中/低). The
 * former numeric Voice column showed "0.0" for pasted reports that carry no
 * numeric volume, and the separate Severity column rendered the same value —
 * the two are merged into one faithful Heat column.
 *
 * Topic cell:
 *   line 1 — TopTopic.topic (the per-week display label)
 *   line 2 — canonical_title (from `categoryResolution`), muted; falls
 *            back to Chinese with `(Chinese original)` indicator on en
 *            mode when canonical_title_en is null
 *
 * Spec ref: ui-design-system §3.3 (card chrome), §6.3 (Minimalist Design),
 *           Information Hierarchy 5.2 (dashboard surfaces glance first).
 */

const SEVERITY_VARIANT: Record<
  TopTopic['severity'],
  { labelKey: string; variant: 'danger' | 'warning' | 'info' }
> = {
  high: { labelKey: 'report.topTopics.severityHigh', variant: 'danger' },
  medium: { labelKey: 'report.topTopics.severityMedium', variant: 'warning' },
  low: { labelKey: 'report.topTopics.severityLow', variant: 'info' },
};

function RankBadge({
  rank,
  confirmed,
}: {
  rank: string;
  confirmed: boolean | undefined;
}) {
  // Rank string sometimes carries the cross-engine confirmed marker as
  // ` ✓`; strip it so the number renders cleanly and the Check icon
  // owns the indicator.
  const cleanRank = rank.replace(/\s*✓\s*/, '');
  return (
    <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-foreground">
      {cleanRank}
      {confirmed && (
        <Check
          className="h-3.5 w-3.5 text-success"
          strokeWidth={2.25}
          aria-label="Cross-engine confirmed"
        />
      )}
    </span>
  );
}

function CategorySubtitle({
  state,
  lang,
}: {
  state: CategoryCellState;
  lang: 'zh' | 'en';
}) {
  if (state.kind !== 'canonical') return null;
  if (lang === 'zh') {
    return (
      <span className="text-foreground-muted">{state.titleZh}</span>
    );
  }
  if (state.titleEn && state.titleEn.trim().length > 0) {
    return <span className="text-foreground-muted">{state.titleEn}</span>;
  }
  return (
    <span className="text-foreground-muted">
      {state.titleZh}{' '}
      <span className="text-foreground-subtle">(Chinese original)</span>
    </span>
  );
}

export interface CompactTopTopicsTableProps {
  topics: TopTopic[];
  /**
   * Per-row category resolution. Optional — when omitted, the secondary
   * category line is not rendered (zero-impact for callers without a
   * resolution map).
   */
  categoryResolution?: CategoryCellState[];
}

export default function CompactTopTopicsTable({
  topics,
  categoryResolution,
}: CompactTopTopicsTableProps) {
  const { t, i18n } = useTranslation();
  if (!topics || topics.length === 0) return null;

  const lang: 'zh' | 'en' = i18n.language?.startsWith('zh') ? 'zh' : 'en';

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-14" />
          <col />
          <col className="w-24" />
        </colgroup>
        <thead>
          <tr className="bg-muted/40">
            <th
              scope="col"
              className="border-b border-border px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
            >
              {t('report.topTopics.rank')}
            </th>
            <th
              scope="col"
              className="border-b border-border px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
            >
              {t('report.topTopics.topic')}
            </th>
            <th
              scope="col"
              className="border-b border-border px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-muted"
            >
              {t('report.topTopics.heat')}
            </th>
          </tr>
        </thead>
        <tbody>
          {topics.map((topicRow, i) => {
            const sev = SEVERITY_VARIANT[topicRow.severity];
            const categoryState = categoryResolution?.[i] ?? {
              kind: 'unmapped' as const,
            };
            return (
              <tr key={i} className="hover:bg-muted/40">
                <td className="border-b border-border px-3 py-3 align-top last:border-b-0">
                  <RankBadge
                    rank={topicRow.rank}
                    confirmed={topicRow.cross_engine_confirmed}
                  />
                </td>
                <td className="border-b border-border px-3 py-3 align-top last:border-b-0">
                  <div className="text-sm font-medium leading-snug text-foreground">
                    {topicRow.topic}
                  </div>
                  {categoryState.kind === 'canonical' && (
                    <div className="mt-1 text-xs leading-snug">
                      <CategorySubtitle state={categoryState} lang={lang} />
                    </div>
                  )}
                </td>
                <td className="border-b border-border px-3 py-3 text-right align-top last:border-b-0">
                  <Badge variant={sev.variant}>{t(sev.labelKey)}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
