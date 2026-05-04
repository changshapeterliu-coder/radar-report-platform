'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { computeCoverageDate, toShanghai } from '@/lib/daily-alert/coverage-window';
import type { AlertsOverviewResponse } from '@/types/daily-alert';
import { SevenDayOverviewTable } from '@/components/alerts/SevenDayOverviewTable';
import { DayDetailPane } from '@/components/alerts/DayDetailPane';
import { PageShiftControls } from '@/components/alerts/PageShiftControls';
import { Button } from '@/components/ui/button';

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
 * Design refs:
 * - ui-design-system.md sec 9.1 (page header — controls belong in the header's
 *   right slot, not between the table and the detail pane — this fixes
 *   anti-pattern 9)
 * - power design-guidelines.md sec 3.12 Clear Affordances, sec 5.11 Landmarks
 *
 * Top: 7-day overview table (keyboard-navigable). Bottom: detail pane that
 * re-renders in place on row selection (no route change).
 * Default selection on first render AND after every window shift = newest row.
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
      {/* Page header with inline date-window controls (ui-design-system sec 9.1).
          Controls belong next to their data (addresses anti-pattern 9: no more
          sandwiching navigation between the table and the detail pane). */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t('alerts.title')}
          </h1>
        </div>
        <PageShiftControls
          windowEndDate={windowEndDate}
          onShift={handleWindowShift}
        />
      </header>

      {error ? (
        <div className="rounded-lg border border-danger/20 bg-danger-bg p-6 text-center">
          <AlertCircle
            className="mx-auto mb-2 h-8 w-8 text-danger"
            strokeWidth={1.75}
            aria-hidden
          />
          <p className="mb-4 text-sm text-danger-fg">
            {t('alerts.errorLoading')}
          </p>
          <Button variant="outline" size="sm" onClick={() => void mutate()}>
            {t('alerts.retry')}
          </Button>
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
