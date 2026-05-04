'use client';

import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
          className="animate-pulse rounded-lg border border-border bg-card p-5"
        >
          <div className="mb-4 flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-muted" />
            <div className="h-4 w-2/3 rounded bg-muted" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-full rounded bg-muted/70" />
            <div className="h-3 w-5/6 rounded bg-muted/70" />
            <div className="h-3 w-4/6 rounded bg-muted/70" />
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
 *   - 'no-run'     -> NoRunPlaceholder
 *   - 'empty-day'  -> EmptyDayDisplay
 *   - 'published'  -> topics.map(TopicCard)
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
      <div className="rounded-lg border border-danger/20 bg-danger-bg p-6 text-center">
        <AlertCircle
          className="mx-auto mb-2 h-8 w-8 text-danger"
          strokeWidth={1.75}
          aria-hidden
        />
        <p className="mb-3 text-sm text-danger-fg">{t('alerts.errorLoading')}</p>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => void mutate()}
        >
          {t('alerts.retry')}
        </Button>
      </div>
    );
  }

  if (!data) return null;

  if (data.kind === 'no-run') return <NoRunPlaceholder date={date} />;
  if (data.kind === 'empty-day')
    return <EmptyDayDisplay alert={data.alert} lang={lang} />;

  return (
    <section className="space-y-4">
      {data.topics.map((topic) => (
        <TopicCard key={topic.id} topic={topic} lang={lang} />
      ))}
    </section>
  );
}
