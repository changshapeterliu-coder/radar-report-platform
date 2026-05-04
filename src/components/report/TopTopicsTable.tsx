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
 *   Rank / Topic / Voice Volume / Keywords / Seller Discussion / Severity
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

export interface TopTopicsTableProps {
  topics: TopTopic[];
  /** Table heading — optional. */
  caption?: string;
}

export default function TopTopicsTable({
  topics,
  caption,
}: TopTopicsTableProps) {
  const { t } = useTranslation();
  if (!topics || topics.length === 0) return null;
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
