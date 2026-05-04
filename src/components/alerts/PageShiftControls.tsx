'use client';

import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { computeCoverageDate, toShanghai } from '@/lib/daily-alert/coverage-window';
import { Button } from '@/components/ui/button';

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
 * Page-shift controls: "<- View older 7 days" and "Newer 7 days ->".
 * The Newer button is disabled when windowEndDate already matches today-1
 * in Asia/Shanghai (the latest completed coverage date).
 *
 * Now uses Button primitive with lucide icons for consistency with the rest
 * of the app. Positioned inside the /alerts page header (see that file).
 */
export function PageShiftControls({
  windowEndDate,
  onShift,
}: PageShiftControlsProps) {
  const { t } = useTranslation();
  const latestPossibleEndDate = computeCoverageDate(toShanghai(new Date()));
  const atLatest = windowEndDate >= latestPossibleEndDate;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onShift(shiftDate(windowEndDate, -7))}
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
        {t('alerts.viewOlder')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          if (atLatest) return;
          const next = shiftDate(windowEndDate, 7);
          onShift(next > latestPossibleEndDate ? latestPossibleEndDate : next);
        }}
        disabled={atLatest}
        title={atLatest ? t('alerts.viewNewerDisabled') : undefined}
      >
        {t('alerts.viewNewer')}
        <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
      </Button>
    </div>
  );
}
