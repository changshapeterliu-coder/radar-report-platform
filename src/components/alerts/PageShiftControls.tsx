'use client';

import { useTranslation } from 'react-i18next';
import { computeCoverageDate, toShanghai } from '@/lib/daily-alert/coverage-window';

export interface PageShiftControlsProps {
  windowEndDate: string; // YYYY-MM-DD
  onShift: (newEndDate: string) => void;
}

/** Add deltaDays to a YYYY-MM-DD string and return a YYYY-MM-DD string. */
function shiftDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map((s) => Number.parseInt(s, 10));
  const anchor = new Date(Date.UTC(y, m - 1, d));
  anchor.setUTCDate(anchor.getUTCDate() + deltaDays);
  const yy = anchor.getUTCFullYear().toString().padStart(4, '0');
  const mm = (anchor.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = anchor.getUTCDate().toString().padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Page-shift controls: "← View older 7 days" and "Newer 7 days →".
 * The Newer button is disabled when `windowEndDate` already matches today-1
 * in Asia/Shanghai (the latest completed coverage date).
 */
export function PageShiftControls({ windowEndDate, onShift }: PageShiftControlsProps) {
  const { t } = useTranslation();
  const latestPossibleEndDate = computeCoverageDate(toShanghai(new Date()));
  const atLatest = windowEndDate >= latestPossibleEndDate;

  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={() => onShift(shiftDate(windowEndDate, -7))}
        className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-[#232f3e] hover:border-[#ff9900] hover:text-[#ff9900] transition-colors"
      >
        {t('alerts.viewOlder')}
      </button>
      <button
        type="button"
        onClick={() => {
          if (atLatest) return;
          const next = shiftDate(windowEndDate, 7);
          // Clamp to the latest possible end date to avoid shifting past today-1
          onShift(next > latestPossibleEndDate ? latestPossibleEndDate : next);
        }}
        disabled={atLatest}
        title={atLatest ? t('alerts.viewNewerDisabled') : undefined}
        className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-[#232f3e] hover:border-[#ff9900] hover:text-[#ff9900] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-gray-300 disabled:hover:text-[#232f3e]"
      >
        {t('alerts.viewNewer')}
      </button>
    </div>
  );
}
