'use client';

import { useEffect, useState, useMemo, use } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Pin } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SpinnerBlock } from '@/components/ui/spinner';
import type { Database } from '@/types/database';

/**
 * News detail page.
 *
 * Design refs:
 * - ui-design-system.md §2.2 (Chinese paragraphs need leading-relaxed)
 * - power design-guidelines.md §6.1 Readability, §6.3 Minimalist Design
 * - power ui-guidelines.md "Copy" — utility copy over marketing voice
 */

type NewsRow = Database['public']['Tables']['news']['Row'];

export default function NewsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [news, setNews] = useState<NewsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchNews = async () => {
      const { data, error: fetchErr } = await supabase
        .from('news')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchErr) {
        setError(fetchErr.message);
      } else {
        setNews(data as NewsRow);
      }
      setLoading(false);
    };

    fetchNews();
  }, [supabase, id]);

  if (loading) {
    return <SpinnerBlock />;
  }

  if (error || !news) {
    return (
      <div className="py-16 text-center">
        <p className="text-lg font-semibold text-foreground">
          {t('common.error')}
        </p>
        <p className="mt-2 text-sm text-foreground-muted">
          {error ?? 'News not found'}
        </p>
        <Button
          variant="outline"
          className="mt-6"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          {t('common.back')}
        </Button>
      </div>
    );
  }

  // Prefer EN translation when UI language is English
  const translated = (news as Record<string, unknown>).content_translated as {
    title?: string;
    summary?: string;
    content?: string;
  } | null;
  const displayTitle =
    i18n.language === 'en' && translated?.title ? translated.title : news.title;
  const displayContent =
    i18n.language === 'en' && translated?.content
      ? translated.content
      : news.content;

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
          {displayTitle}
        </h1>

        <p className="mt-2 text-xs text-foreground-subtle">
          {new Date(news.published_at).toLocaleDateString()}
        </p>

        <div className="mt-6 whitespace-pre-wrap text-base leading-relaxed text-foreground">
          {displayContent}
        </div>
      </article>
    </div>
  );
}
