'use client';

import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import type { DayDetailResponse } from '@/types/daily-alert';
import { TopicCard } from './TopicCard';
import { NoRunPlaceholder } from './NoRunPlaceholder';
import { EmptyDayDisplay } from './EmptyDayDisplay';

export interface DayDetailPaneProps {
  date: string;
  lang: 'zh' | 'en';
}

async function fetcher(url: string): Promise<DayDetailResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message || `Failed to load day detail (${res.status})`);
  }
  const body = (await res.json()) as { data: DayDetailResponse };
  return body.data;
}

function SkeletonPane() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-lg border border-gray-200 bg-white p-5 animate-pulse"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="h-8 w-8 rounded-full bg-gray-200" />
            <div className="h-4 w-2/3 rounded bg-gray-200" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-full rounded bg-gray-100" />
            <div className="h-3 w-5/6 rounded bg-gray-100" />
            <div className="h-3 w-4/6 rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Detail pane for a single coverage date. Keyed on `date` at the parent level
 * so that switching days remounts and the SWR cache key is fresh.
 *
 * Branches on response `kind`:
 *   - 'no-run'     → NoRunPlaceholder
 *   - 'empty-day'  → EmptyDayDisplay
 *   - 'published'  → topics.map(TopicCard)
 */
export function DayDetailPane({ date, lang }: DayDetailPaneProps) {
  const { t } = useTranslation();
  const { data, error, isLoading, mutate } = useSWR<DayDetailResponse>(
    `/api/alerts/by-date/${date}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  if (isLoading) return <SkeletonPane />;

  if (error) {
    return (
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
    );
  }

  if (!data) return null;

  if (data.kind === 'no-run') return <NoRunPlaceholder date={date} />;
  if (data.kind === 'empty-day') return <EmptyDayDisplay alert={data.alert} lang={lang} />;

  return (
    <section className="space-y-4">
      {data.topics.map((topic) => (
        <TopicCard key={topic.id} topic={topic} lang={lang} />
      ))}
    </section>
  );
}
