'use client';

import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Pin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getDisplayNewsFields } from '@/lib/content-display';
import type { NewsRow } from '../loaders';

export default function NewsDetailClient({ news }: { news: NewsRow }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();

  const display = getDisplayNewsFields(
    news as unknown as Parameters<typeof getDisplayNewsFields>[0],
    i18n.language
  );

  return (
    <div className="mx-auto max-w-3xl">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.back()}
        className="mb-4 -ml-2"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        {t('common.back')}
      </Button>

      <article className="rounded-lg border border-border bg-card p-6 sm:p-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {news.is_pinned && (
            <Badge variant="danger">
              <Pin className="h-3 w-3" strokeWidth={2} />
              {t('news.pinned')}
            </Badge>
          )}
          <Badge variant="outline">{news.source_channel}</Badge>
        </div>

        <h1 className="text-2xl font-semibold leading-tight text-foreground">
          {display.title}
        </h1>

        <p className="mt-2 text-xs text-foreground-subtle">
          {new Date(news.published_at).toLocaleDateString()}
        </p>

        <div className="mt-6 whitespace-pre-wrap text-base leading-relaxed text-foreground">
          {display.content}
        </div>
      </article>
    </div>
  );
}
