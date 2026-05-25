'use client';

import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { Pin, Newspaper } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getDisplayNewsFields } from '@/lib/content-display';
import type { NewsRow } from './loaders';

export default function NewsListClient({ news }: { news: NewsRow[] }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();

  const getDisplay = (item: NewsRow) =>
    getDisplayNewsFields(
      item as unknown as Parameters<typeof getDisplayNewsFields>[0],
      i18n.language
    );

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">
          {t('news.title')}
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">
          {news.length > 0
            ? `${news.length} ${news.length === 1 ? 'item' : 'items'}`
            : ''}
        </p>
      </div>

      {news.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card py-16 text-center">
          <Newspaper
            className="mb-3 h-10 w-10 text-foreground-subtle"
            strokeWidth={1.5}
          />
          <p className="text-sm text-foreground-muted">{t('news.noNews')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {news.map((item) => {
            const display = getDisplay(item);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/news/${item.id}`)}
                  className="group flex w-full items-start justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-[-2px] sm:px-6"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">
                        {display.title}
                      </h3>
                      {item.is_pinned && (
                        <Badge variant="danger">
                          <Pin className="h-3 w-3" strokeWidth={2} />
                          {t('news.pinned')}
                        </Badge>
                      )}
                      <Badge variant="outline">{item.source_channel}</Badge>
                    </div>
                    {display.summary && (
                      <p className="mt-1.5 text-sm leading-relaxed text-foreground-muted line-clamp-2">
                        {display.summary}
                      </p>
                    )}
                  </div>
                  <span className="whitespace-nowrap text-xs text-foreground-subtle">
                    {new Date(item.published_at).toLocaleDateString()}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
