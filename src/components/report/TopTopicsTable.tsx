'use client';

import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { TopTopic } from '@/types/report';

/**
 * TopTopicsTable — structured Top-N summary table rendered directly from
 * TopTopic[] (v4 schema), not from AI-produced table JSON.
 *
 * Columns (fixed):
 *   Rank / Topic / Category? / Voice Volume / Keywords / Seller Discussion / Severity
 *
 * The `Category` column is conditional: it only renders when the caller
 * passes `categoryResolution` (zero-impact for existing call sites that
 * predate the unified topic dictionary work — Spec ref: design §17.1).
 *
 * Rank column respects the `cross_engine_confirmed` hint:
 *   - confirmed  -> rank + green lucide Check (cross-engine)
 *   - unconfirmed -> rank plain (single-engine)
 *
 * Severity uses the Badge primitive's semantic variants (aligned to
 * ui-design-system.md sec 1.3 — high = danger, medium = warning, low = info).
 *
 * All column labels + severity pill labels go through i18n so the UI follows
 * the global zh/en language switch (Principle 3, user rule: language toggle
 * is the single system switch).
 */

const SEVERITY_VARIANT: Record<
  TopTopic['severity'],
  { labelKey: string; variant: 'danger' | 'warning' | 'info' }
> = {
  high: { labelKey: 'report.topTopics.severityHigh', variant: 'danger' },
  medium: { labelKey: 'report.topTopics.severityMedium', variant: 'warning' },
  low: { labelKey: 'report.topTopics.severityLow', variant: 'info' },
};

/**
 * Per-row category resolution states for the Category column.
 *
 * - `canonical` — row is mapped to a canonical topic; render the resolved
 *    title (zh on zh-mode; en on en-mode; zh + `(Chinese original)` indicator
 *    when en is null/empty on en-mode). Spec ref: Req 17.4(a).
 * - `dropped` — engine intentionally dropped this topic; render `—` with
 *    `title=dropReason` for hover detail. Spec ref: Req 17.4(b).
 * - `unmapped` — no canonical, no drop reason (e.g. legacy row pre-canonicalize);
 *    render `—` with no tooltip. Spec ref: Req 17.4(c).
 *
 * Priority when a data row has both a canonical key and a drop reason
 * (shouldn't happen, but defensive): canonical wins. Resolution is the
 * caller's responsibility — this type just describes what to render.
 */
export type CategoryCellState =
  | { kind: 'canonical'; titleZh: string; titleEn: string | null }
  | { kind: 'dropped'; dropReason: string }
  | { kind: 'unmapped' };

function RankBadge({
  rank,
  confirmed,
}: {
  rank: string;
  confirmed: boolean | undefined;
}) {
  if (confirmed) {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-foreground">
        {rank.replace(/\s*✓\s*/, '')}
        <Check className="h-3.5 w-3.5 text-success" strokeWidth={2.25} aria-label="Cross-engine confirmed" />
      </span>
    );
  }
  return <span className="text-foreground-muted">{rank}</span>;
}

function CategoryCell({
  state,
  lang,
}: {
  state: CategoryCellState;
  lang: 'zh' | 'en';
}) {
  if (state.kind === 'canonical') {
    if (lang === 'zh') {
      return <span className="text-foreground">{state.titleZh}</span>;
    }
    if (state.titleEn && state.titleEn.trim().length > 0) {
      return <span className="text-foreground">{state.titleEn}</span>;
    }
    // en-mode but no en title: show zh with a muted indicator. Spec ref: Req 10.3 / 17.4(a).
    return (
      <span className="text-foreground">
        {state.titleZh}{' '}
        <span className="text-foreground-muted">(Chinese original)</span>
      </span>
    );
  }
  if (state.kind === 'dropped') {
    return (
      <span className="text-foreground-muted" title={state.dropReason}>
        —
      </span>
    );
  }
  // unmapped — no tooltip (Spec ref: Req 17.4(c))
  return <span className="text-foreground-muted">—</span>;
}

export interface TopTopicsTableProps {
  topics: TopTopic[];
  /** Table heading — optional. */
  caption?: string;
  /**
   * Per-row category resolution, index-aligned with `topics`. When omitted,
   * the Category column is not rendered at all (zero-impact for existing
   * call sites). When provided, the column renders unconditionally; rows
   * without a corresponding entry render as `unmapped`.
   *
   * Spec ref: Req 17.1 (column appears with the unified topic dictionary).
   */
  categoryResolution?: Array<CategoryCellState>;
}

export default function TopTopicsTable({
  topics,
  caption,
  categoryResolution,
}: TopTopicsTableProps) {
  const { t, i18n } = useTranslation();
  if (!topics || topics.length === 0) return null;

  const showCategory = categoryResolution !== undefined;
  const lang: 'zh' | 'en' = i18n.language?.startsWith('zh') ? 'zh' : 'en';
  const categoryHeader = lang === 'zh' ? '类别' : 'Category';

  return (
    <div className="my-5 overflow-hidden rounded-lg border border-border">
      {caption && (
        <div className="border-b border-border bg-muted/40 px-4 py-2 text-sm font-semibold text-foreground">
          {caption}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/40">
              <th
                scope="col"
                className="w-16 border-b border-border px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
              >
                {t('report.topTopics.rank')}
              </th>
              <th
                scope="col"
                className="border-b border-border px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
              >
                {t('report.topTopics.topic')}
              </th>
              {showCategory && (
                <th
                  scope="col"
                  className="border-b border-border px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
                >
                  {categoryHeader}
                </th>
              )}
              <th
                scope="col"
                className="w-20 border-b border-border px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
              >
                {t('report.topTopics.voiceVolume')}
              </th>
              <th
                scope="col"
                className="border-b border-border px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
              >
                {t('report.topTopics.keywords')}
              </th>
              <th
                scope="col"
                className="border-b border-border px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
              >
                {t('report.topTopics.sellerDiscussion')}
              </th>
              <th
                scope="col"
                className="w-20 border-b border-border px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
              >
                {t('report.topTopics.severity')}
              </th>
            </tr>
          </thead>
          <tbody>
            {topics.map((topicRow, i) => {
              const sev = SEVERITY_VARIANT[topicRow.severity];
              return (
                <tr key={i} className="hover:bg-muted/40">
                  <td className="border-b border-border px-4 py-3">
                    <RankBadge
                      rank={topicRow.rank}
                      confirmed={topicRow.cross_engine_confirmed}
                    />
                  </td>
                  <td className="border-b border-border px-4 py-3 font-medium text-foreground">
                    {topicRow.topic}
                  </td>
                  {showCategory && (
                    <td className="border-b border-border px-4 py-3 text-sm">
                      <CategoryCell
                        state={categoryResolution[i] ?? { kind: 'unmapped' }}
                        lang={lang}
                      />
                    </td>
                  )}
                  <td className="border-b border-border px-4 py-3 font-mono text-foreground">
                    {topicRow.voice_volume.toFixed(1)}
                  </td>
                  <td className="border-b border-border px-4 py-3 text-xs text-foreground-muted">
                    {topicRow.keywords.join('、')}
                  </td>
                  <td className="border-b border-border px-4 py-3 leading-relaxed text-foreground">
                    {topicRow.seller_discussion}
                  </td>
                  <td className="border-b border-border px-4 py-3">
                    <Badge variant={sev.variant}>{t(sev.labelKey)}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
