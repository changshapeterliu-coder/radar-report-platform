'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { Pin, Newspaper } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useDomain } from '@/contexts/DomainContext';
import { Badge } from '@/components/ui/badge';
import { SpinnerBlock } from '@/components/ui/spinner';
import type { Database } from '@/types/database';

/**
 * News list page.
 *
 * Design refs:
 * - ui-design-system.md §9.1 (page header), §3.3 (card conventions)
 * - power design-guidelines.md §5.3 Scannability, §5.4 List Design
 * - power ui-guidelines.md "App Surfaces" — utility copy, divider-separated
 *   rows over independent cards
 *
 * Pinned items still surface visually (Pin icon + Hot badge) but use the
 * same row chrome as regular items — no "two worlds" effect.
 */

type NewsRow = Database['public']['Tables']['news']['Row'];

export default function NewsPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { currentDomainId } = useDomain();
  const supabase = useMemo(() => createClient(), []);

  const [news, setNews] = useState<NewsRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentDomainId) return;

    const fetchNews = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('news')
        .select('*')
        .eq('domain_id', currentDomainId)
        .order('is_pinned', { ascending: false })
        .order('published_at', { ascending: false });

      if (!error && data) {
        setNews(data as NewsRow[]);
      }
      setLoading(false);
    };

    fetchNews();
  }, [supabase, currentDomainId]);

  // Prefer EN translation when UI language is English; otherwise fall back
  // to the original (assumed Chinese).
  const getDisplay = (item: NewsRow) => {
    const translated = (item as Record<string, unknown>).content_translated as {
      title?: string;
      summary?: string;
    } | null;
    const useTranslated = i18n.language === 'en' && translated;
    return {
      title: useTranslated && translated.title ? translated.title : item.title,
      summary:
        useTranslated && translated.summary ? translated.summary : item.summary,
    };
  };

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

      {loading ? (
        <SpinnerBlock />
      ) : news.length === 0 ? (
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
