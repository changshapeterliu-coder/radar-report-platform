'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { createClient } from '@/lib/supabase/client';
import { useDomain } from '@/contexts/DomainContext';
import type { Database } from '@/types/database';

type NewsRow = Database['public']['Tables']['news']['Row'];

export default function NewsPage() {
  const { t } = useTranslation();
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

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#232f3e] mb-6">{t('news.title')}</h1>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#ff9900] border-r-transparent" />
        </div>
      ) : news.length === 0 ? (
        <p className="text-center text-gray-500 py-12">{t('news.noNews')}</p>
      ) : (
        <div className="space-y-3">
          {news.map((item) => (
            <button
              key={item.id}
              onClick={() => router.push(`/news/${item.id}`)}
              className="w-full text-left bg-white rounded-lg border border-gray-200 p-4 hover:border-[#ff9900] hover:shadow transition-all"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-[#232f3e]">{item.title}</h3>
                    {item.is_pinned && (
                      <span className="inline-block rounded-full bg-red-100 text-red-700 border border-red-300 px-2 py-0.5 text-xs font-bold">
                        {t('news.pinned')}
                      </span>
                    )}
                    <span className="inline-block rounded-full bg-gray-100 text-gray-600 border border-gray-300 px-2 py-0.5 text-xs">
                      {item.source_channel}
                    </span>
                  </div>
                  {item.summary && (
                    <p className="text-sm text-gray-600 mt-1 line-clamp-2">{item.summary}</p>
                  )}
                </div>
                <p className="text-xs text-gray-400 whitespace-nowrap">
                  {new Date(item.published_at).toLocaleDateString()}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
