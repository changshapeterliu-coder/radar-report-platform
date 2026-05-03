'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { computeCoverageDate, toShanghai } from '@/lib/daily-alert/coverage-window';
import type { AlertsOverviewResponse } from '@/types/daily-alert';
import { SevenDayOverviewTable } from '@/components/alerts/SevenDayOverviewTable';
import { DayDetailPane } from '@/components/alerts/DayDetailPane';
import { PageShiftControls } from '@/components/alerts/PageShiftControls';

async function fetcher(url: string): Promise<AlertsOverviewResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message || `Failed to load alerts (${res.status})`);
  }
  const body = (await res.json()) as { data: AlertsOverviewResponse };
  return body.data;
}

/**
 * /alerts — master-detail page for the daily hot-topic alert ledger.
 *
 * Top half: 7-day overview table (keyboard-navigable). Bottom half: detail
 * pane for the selected day, which re-renders in place on row selection
 * (no route change — Requirement 8.2).
 *
 * Default selection on first render AND after every window shift = newest row.
 *
 * Spec: Requirements 8.1–8.11.
 */
export default function AlertsPage() {
  const { t, i18n } = useTranslation();
  const lang: 'zh' | 'en' = i18n.language === 'en' ? 'en' : 'zh';

  const [windowEndDate, setWindowEndDate] = useState<string>(() =>
    computeCoverageDate(toShanghai(new Date()))
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { data: overview, error, isLoading, mutate } = useSWR<AlertsOverviewResponse>(
    `/api/alerts?window_end_date=${windowEndDate}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  // Default-select newest row on first load AND on every window shift.
  useEffect(() => {
    if (overview?.overview && overview.overview.length > 0) {
      const dates = new Set(overview.overview.map((r) => r.date));
      if (selectedDate === null || !dates.has(selectedDate)) {
        setSelectedDate(overview.overview[0].date);
      }
    }
  }, [overview, selectedDate]);

  const handleWindowShift = (newEnd: string) => {
    setWindowEndDate(newEnd);
    setSelectedDate(null); // Triggers newest-row selection in the effect above
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-[#232f3e]">{t('alerts.title')}</h1>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-700 mb-3">{t('alerts.errorLoading')}</p>
          <button
            type="button"
            onClick={() => void mutate()}
            className="rounded border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
          >
            {t('alerts.retry')}
          </button>
        </div>
      ) : (
        <>
          <SevenDayOverviewTable
            overview={overview?.overview ?? []}
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
            lang={lang}
            loading={isLoading}
          />

          <PageShiftControls windowEndDate={windowEndDate} onShift={handleWindowShift} />

          {selectedDate && (
            <section aria-label="Day detail" className="mt-2">
              <DayDetailPane key={selectedDate} date={selectedDate} lang={lang} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
