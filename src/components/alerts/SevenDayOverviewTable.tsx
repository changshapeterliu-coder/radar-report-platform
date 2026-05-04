'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type { AlertsOverviewResponse } from '@/types/daily-alert';
import { TopicPreviewList } from './TopicPreviewList';

type OverviewRow = AlertsOverviewResponse['overview'][number];

export interface SevenDayOverviewTableProps {
  overview: OverviewRow[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
  lang: 'zh' | 'en';
  loading?: boolean;
}

type WeekdayKey = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
const WEEKDAY_KEYS: readonly WeekdayKey[] = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
] as const;

function StatusChip({ status }: { status: OverviewRow['status'] }) {
  const { t } = useTranslation();
  const variant: 'success' | 'danger' | 'default' =
    status === 'published'
      ? 'success'
      : status === 'failed'
        ? 'danger'
        : 'default';
  const label =
    status === 'published'
      ? t('alerts.status.published')
      : status === 'failed'
        ? t('alerts.status.failed')
        : t('alerts.status.noRun');
  return <Badge variant={variant}>{label}</Badge>;
}

/**
 * 7-day overview table with keyboard navigation:
 *   ArrowUp / ArrowDown - move selection up / down
 *   Home / End          - jump to first / last row
 *   Enter / Space       - select the focused row (also fires on click)
 *
 * Design refs:
 * - ui-design-system.md sec 1.3 (semantic tokens for status)
 * - power design-guidelines.md sec 3.12 Clear Affordances
 *
 * Responsive: collapses the Top-Topic Preview column to `hidden sm:table-cell`
 * on small screens; mobile layout shows a single combined pill list under
 * the date instead.
 */
export function SevenDayOverviewTable({
  overview,
  selectedDate,
  onSelect,
  lang,
  loading = false,
}: SevenDayOverviewTableProps) {
  const { t } = useTranslation();
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);

  const selectedIdx = selectedDate
    ? overview.findIndex((r) => r.date === selectedDate)
    : -1;

  // After selection change, move focus to the selected row (so keyboard events
  // target the right element). Only act when overview is populated to avoid
  // focus flicker during initial load.
  useEffect(() => {
    if (selectedIdx >= 0) {
      const el = rowRefs.current[selectedIdx];
      if (el && document.activeElement instanceof HTMLTableRowElement) {
        el.focus();
      }
    }
  }, [selectedIdx]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTableRowElement>, idx: number) => {
      if (overview.length === 0) return;
      let nextIdx: number | null = null;
      switch (e.key) {
        case 'ArrowDown':
          nextIdx = Math.min(idx + 1, overview.length - 1);
          break;
        case 'ArrowUp':
          nextIdx = Math.max(idx - 1, 0);
          break;
        case 'Home':
          nextIdx = 0;
          break;
        case 'End':
          nextIdx = overview.length - 1;
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          onSelect(overview[idx].date);
          return;
        default:
          return;
      }
      if (nextIdx !== null && nextIdx !== idx) {
        e.preventDefault();
        onSelect(overview[nextIdx].date);
        rowRefs.current[nextIdx]?.focus();
      }
    },
    [overview, onSelect]
  );

  if (loading && overview.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <Spinner size="md" />
        <p className="mt-3 text-sm text-foreground-muted">
          {t('alerts.loading')}
        </p>
      </div>
    );
  }

  if (overview.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-sm text-foreground-muted">{t('common.noData')}</p>
      </div>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-lg border border-border bg-card"
      role="region"
      aria-label={t('alerts.title')}
    >
      <table className="w-full border-collapse" role="grid">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th
              scope="col"
              className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
            >
              {t('alerts.overview.headers.date')}
            </th>
            <th
              scope="col"
              className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
            >
              {t('alerts.overview.headers.status')}
            </th>
            <th
              scope="col"
              className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
            >
              {t('alerts.overview.headers.topicCount')}
            </th>
            <th
              scope="col"
              className="hidden px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted sm:table-cell"
            >
              {t('alerts.overview.headers.preview')}
            </th>
          </tr>
        </thead>
        <tbody>
          {overview.map((row, idx) => {
            const selected = row.date === selectedDate;
            const weekdayKey = WEEKDAY_KEYS.includes(row.weekday as WeekdayKey)
              ? (row.weekday as WeekdayKey)
              : null;
            const weekdayLabel = weekdayKey
              ? t(`alerts.weekdays.${weekdayKey}`)
              : row.weekday;
            return (
              <tr
                key={row.date}
                ref={(el) => {
                  rowRefs.current[idx] = el;
                }}
                role="row"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelect(row.date)}
                onKeyDown={(e) => handleKeyDown(e, idx)}
                className={cn(
                  'cursor-pointer border-b border-border last:border-b-0 outline-none transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
                  selected
                    ? 'border-l-2 border-l-primary bg-primary-soft/40'
                    : 'border-l-2 border-l-transparent hover:bg-muted/40'
                )}
              >
                <td className="px-4 py-3 text-sm">
                  <div className="font-mono font-medium text-foreground">
                    {row.date}
                  </div>
                  <div className="text-xs text-foreground-muted">
                    {weekdayLabel}
                  </div>
                  {/* Mobile-only topic pills (overview column is hidden on sm:) */}
                  <div className="mt-2 sm:hidden">
                    <TopicPreviewList
                      topics={row.top_topic_preview}
                      lang={lang}
                    />
                  </div>
                </td>
                <td className="px-4 py-3 text-sm">
                  <StatusChip status={row.status} />
                </td>
                <td className="px-4 py-3 font-mono text-sm text-foreground-muted">
                  {row.topic_count == null ? '-' : row.topic_count}
                </td>
                <td className="hidden px-4 py-3 text-sm sm:table-cell">
                  <TopicPreviewList
                    topics={row.top_topic_preview}
                    lang={lang}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
