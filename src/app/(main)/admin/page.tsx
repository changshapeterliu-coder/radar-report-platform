'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { AdminGuard } from '@/components/AdminGuard';
import { createClient } from '@/lib/supabase/client';
import { useDomain } from '@/contexts/DomainContext';
import type { Database } from '@/types/database';

type ReportRow = Database['public']['Tables']['reports']['Row'];
type NewsRow = Database['public']['Tables']['news']['Row'];

export default function AdminPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentDomainId } = useDomain();
  const supabase = useMemo(() => createClient(), []);
  const [drafts, setDrafts] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  // News management state
  const [newsItems, setNewsItems] = useState<NewsRow[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [actioningNewsId, setActioningNewsId] = useState<string | null>(null);

  const fetchDrafts = useCallback(async () => {
    if (!currentDomainId) return;
    setLoading(true);
    const { data } = await supabase
      .from('reports')
      .select('*')
      .eq('domain_id', currentDomainId)
      .eq('status', 'draft')
      .order('updated_at', { ascending: false });
    setDrafts((data ?? []) as ReportRow[]);
    setLoading(false);
  }, [supabase, currentDomainId]);

  const fetchNews = useCallback(async () => {
    if (!currentDomainId) return;
    setNewsLoading(true);
    const { data } = await supabase
      .from('news')
      .select('*')
      .eq('domain_id', currentDomainId)
      .order('is_pinned', { ascending: false })
      .order('published_at', { ascending: false });
    setNewsItems((data ?? []) as NewsRow[]);
    setNewsLoading(false);
  }, [supabase, currentDomainId]);

  useEffect(() => { fetchDrafts(); fetchNews(); }, [fetchDrafts, fetchNews]);

  const handlePublish = async (id: string) => {
    await fetch(`/api/reports/${id}/publish`, { method: 'PUT' });
    fetchDrafts();
  };

  const handleDelete = async (id: string) => {
    await supabase.from('reports').delete().eq('id', id);
    fetchDrafts();
  };

  const handleDeleteNews = async (id: string) => {
    setActioningNewsId(id);
    await fetch(`/api/news/${id}`, { method: 'DELETE' });
    fetchNews();
    setActioningNewsId(null);
  };

  const handleTogglePin = async (id: string, currentlyPinned: boolean) => {
    setActioningNewsId(id);
    await fetch(`/api/news/${id}/pin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_pinned: !currentlyPinned }),
    });
    fetchNews();
    setActioningNewsId(null);
  };

  return (
    <AdminGuard>
      <div>
        <h1 className="text-2xl font-bold text-[#232f3e] mb-6">{t('admin.title')}</h1>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
          <Link href="/admin/reports/new" className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 hover:border-[#ff9900] hover:shadow transition-all">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#ff9900]/10 text-[#ff9900]">📄</div>
            <span className="font-medium text-[#232f3e]">{t('admin.createReport')}</span>
          </Link>
          <Link href="/admin/news/new" className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 hover:border-[#ff9900] hover:shadow transition-all">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#146eb4]/10 text-[#146eb4]">📰</div>
            <span className="font-medium text-[#232f3e]">{t('admin.createNews')}</span>
          </Link>
          <Link href="/admin/users" className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 hover:border-[#ff9900] hover:shadow transition-all">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 text-purple-700">👥</div>
            <span className="font-medium text-[#232f3e]">Manage Users</span>
          </Link>
          <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 opacity-60">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500">🌐</div>
            <span className="font-medium text-gray-500">{t('admin.manageDomains')}</span>
          </div>
        </div>

        {/* Draft Reports Section */}
        <h2 className="text-lg font-bold text-[#232f3e] mb-3">{t('admin.drafts')}</h2>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-[#ff9900] border-r-transparent" />
          </div>
        ) : drafts.length === 0 ? (
          <p className="text-gray-500 text-sm py-4">{t('common.noData')}</p>
        ) : (
          <div className="space-y-2">
            {drafts.map((draft) => (
              <div key={draft.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white rounded-lg border border-gray-200 p-4">
                <div>
                  <h3 className="font-medium text-[#232f3e]">{draft.title}</h3>
                  <p className="text-xs text-gray-400">
                    {draft.type === 'regular' ? t('reports.filterRegular') : t('reports.filterTopic')} · {draft.date_range}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handlePublish(draft.id)} className="rounded bg-[#ff9900] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#e88b00]">
                    {t('admin.publish')}
                  </button>
                  <button onClick={() => handleDelete(draft.id)} className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                    {t('admin.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* News Management Section */}
        <h2 className="text-lg font-bold text-[#232f3e] mt-10 mb-3">📰 News Management</h2>
        {newsLoading ? (
          <div className="flex justify-center py-8">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-[#146eb4] border-r-transparent" />
          </div>
        ) : newsItems.length === 0 ? (
          <p className="text-gray-500 text-sm py-4">No news items found.</p>
        ) : (
          <div className="space-y-2">
            {newsItems.map((item) => (
              <div key={item.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium text-[#232f3e]">{item.title}</h3>
                    {item.is_pinned && (
                      <span className="inline-block rounded-full bg-red-100 text-red-700 border border-red-300 px-2 py-0.5 text-xs font-bold">
                        Pinned
                      </span>
                    )}
                    <span className="inline-block rounded-full bg-gray-100 text-gray-600 border border-gray-300 px-2 py-0.5 text-xs">
                      {item.source_channel}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(item.published_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => router.push(`/admin/news/${item.id}/edit`)}
                    className="rounded border border-[#146eb4] px-3 py-1.5 text-xs font-medium text-[#146eb4] hover:bg-blue-50"
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => handleTogglePin(item.id, item.is_pinned)}
                    disabled={actioningNewsId === item.id}
                    className="rounded border border-[#ff9900] px-3 py-1.5 text-xs font-medium text-[#ff9900] hover:bg-orange-50 disabled:opacity-50"
                  >
                    {item.is_pinned ? '📌 Unpin' : '📌 Pin'}
                  </button>
                  <button
                    onClick={() => handleDeleteNews(item.id)}
                    disabled={actioningNewsId === item.id}
                    className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    🗑️ Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminGuard>
  );
}
