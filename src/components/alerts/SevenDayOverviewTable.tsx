'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
  const classes =
    status === 'published'
      ? 'bg-green-100 text-green-800 border-green-200'
      : status === 'failed'
        ? 'bg-red-100 text-red-800 border-red-200'
        : 'bg-gray-100 text-gray-600 border-gray-200';
  const label =
    status === 'published'
      ? t('alerts.status.published')
      : status === 'failed'
        ? t('alerts.status.failed')
        : t('alerts.status.noRun');
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${classes}`}
    >
      {label}
    </span>
  );
}

/**
 * 7-day overview table with keyboard navigation:
 *   ArrowUp / ArrowDown — move selection up / down
 *   Home / End          — jump to first / last row
 *   Enter / Space       — select the focused row (also fires on click)
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
      // Only move focus if the user is already navigating with keyboard
      // (a row is already in focus). Avoids stealing focus on every state change.
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
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-[#ff9900] border-r-transparent" />
        <p className="mt-3 text-sm text-gray-500">{t('alerts.loading')}</p>
      </div>
    );
  }

  if (overview.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <p className="text-sm text-gray-500">{t('common.noData')}</p>
      </div>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-lg border border-gray-200 bg-white"
      role="region"
      aria-label={t('alerts.title')}
    >
      <table className="w-full border-collapse" role="grid">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="px-4 py-3 text-left text-xs font-semibold text-[#232f3e] uppercase tracking-wide">
              {t('alerts.overview.headers.date')}
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-[#232f3e] uppercase tracking-wide">
              {t('alerts.overview.headers.status')}
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-[#232f3e] uppercase tracking-wide">
              {t('alerts.overview.headers.topicCount')}
            </th>
            <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-semibold text-[#232f3e] uppercase tracking-wide">
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
                className={`cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors outline-none ${
                  selected
                    ? 'bg-blue-50 border-l-4 border-l-[#146eb4]'
                    : 'hover:bg-gray-50 border-l-4 border-l-transparent'
                } focus-visible:ring-2 focus-visible:ring-[#146eb4] focus-visible:ring-inset`}
              >
                <td className="px-4 py-3 text-sm">
                  <div className="font-mono font-medium text-[#232f3e]">{row.date}</div>
                  <div className="text-xs text-gray-500">{weekdayLabel}</div>
                  {/* Mobile-only topic pills (overview column is hidden on sm:) */}
                  <div className="sm:hidden mt-2">
                    <TopicPreviewList topics={row.top_topic_preview} lang={lang} />
                  </div>
                </td>
                <td className="px-4 py-3 text-sm">
                  <StatusChip status={row.status} />
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 font-mono">
                  {row.topic_count == null ? '—' : row.topic_count}
                </td>
                <td className="hidden sm:table-cell px-4 py-3 text-sm">
                  <TopicPreviewList topics={row.top_topic_preview} lang={lang} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
