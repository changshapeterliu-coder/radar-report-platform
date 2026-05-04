import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { TopTopic } from '@/types/report';

/**
 * TopTopicsTable — structured Top-N summary table rendered directly from
 * TopTopic[] (v4 schema), not from AI-produced table JSON.
 *
 * Columns (fixed):
 *   Rank / Topic / 热度 (Voice Volume) / Keywords / 卖家讨论 / 严重度
 *
 * Rank column respects the `cross_engine_confirmed` hint:
 *   - confirmed  -> rank + green lucide Check (cross-engine)
 *   - unconfirmed -> rank plain (single-engine)
 *
 * Severity uses the Badge primitive's semantic variants (aligned to
 * ui-design-system.md sec 1.3 — high = danger, medium = warning, low = info).
 */

const SEVERITY_VARIANT: Record<
  TopTopic['severity'],
  { label: string; variant: 'danger' | 'warning' | 'info' }
> = {
  high: { label: '高', variant: 'danger' },
  medium: { label: '中', variant: 'warning' },
  low: { label: '低', variant: 'info' },
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
                Rank
              </th>
              <th
                scope="col"
                className="border-b border-border px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
              >
                Topic
              </th>
              <th
                scope="col"
                className="w-20 border-b border-border px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
              >
                热度
              </th>
              <th
                scope="col"
                className="border-b border-border px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
              >
                Keywords
              </th>
              <th
                scope="col"
                className="border-b border-border px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
              >
                卖家讨论
              </th>
              <th
                scope="col"
                className="w-20 border-b border-border px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
              >
                严重度
              </th>
            </tr>
          </thead>
          <tbody>
            {topics.map((t, i) => {
              const sev = SEVERITY_VARIANT[t.severity];
              return (
                <tr key={i} className="hover:bg-muted/40">
                  <td className="border-b border-border px-4 py-3">
                    <RankBadge
                      rank={t.rank}
                      confirmed={t.cross_engine_confirmed}
                    />
                  </td>
                  <td className="border-b border-border px-4 py-3 font-medium text-foreground">
                    {t.topic}
                  </td>
                  <td className="border-b border-border px-4 py-3 font-mono text-foreground">
                    {t.voice_volume.toFixed(1)}
                  </td>
                  <td className="border-b border-border px-4 py-3 text-xs text-foreground-muted">
                    {t.keywords.join('、')}
                  </td>
                  <td className="border-b border-border px-4 py-3 leading-relaxed text-foreground">
                    {t.seller_discussion}
                  </td>
                  <td className="border-b border-border px-4 py-3">
                    <Badge variant={sev.variant}>{sev.label}</Badge>
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
