'use client';

import { useEffect, useState, useMemo, use } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/types/database';

type NewsRow = Database['public']['Tables']['news']['Row'];

export default function NewsDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
    return (
      <div className="flex justify-center py-12">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#ff9900] border-r-transparent" />
      </div>
    );
  }

  if (error || !news) {
    return (
      <div className="text-center py-12">
        <p className="text-xl font-semibold text-[#232f3e]">{t('common.error')}</p>
        <p className="mt-2 text-gray-500">{error ?? 'News not found'}</p>
      </div>
    );
  }

  // Follow global language: use translated version if available and lang is EN
  // Assumption: original news written in ZH, translated to EN
  const translated = (news as Record<string, unknown>).content_translated as { title?: string; summary?: string; content?: string } | null;
  const displayTitle = i18n.language === 'en' && translated?.title ? translated.title : news.title;
  const displayContent = i18n.language === 'en' && translated?.content ? translated.content : news.content;

  return (
    <div>
      <button
        onClick={() => router.back()}
        className="mb-4 text-sm text-[#146eb4] hover:underline flex items-center gap-1"
      >
        ← {t('common.back')}
      </button>

      <article className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {news.is_pinned && (
            <span className="inline-block rounded-full bg-red-100 text-red-700 border border-red-300 px-2 py-0.5 text-xs font-bold">
              {t('news.pinned')}
            </span>
          )}
          <span className="inline-block rounded-full bg-gray-100 text-gray-600 border border-gray-300 px-2 py-0.5 text-xs">
            {news.source_channel}
          </span>
        </div>

        <h1 className="text-2xl font-bold text-[#232f3e] mb-2">{displayTitle}</h1>

        <p className="text-sm text-gray-400 mb-6">
          {new Date(news.published_at).toLocaleDateString()}
        </p>

        <div className="prose max-w-none text-gray-700 whitespace-pre-wrap">
          {displayContent}
        </div>
      </article>
    </div>
  );
}
