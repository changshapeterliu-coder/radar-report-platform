'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { AdminGuard } from '@/components/AdminGuard';
import { createClient } from '@/lib/supabase/client';
import { useDomain } from '@/contexts/DomainContext';
import type { Database } from '@/types/database';

type ReportRow = Database['public']['Tables']['reports']['Row'];

export default function AdminPage() {
  const { t } = useTranslation();
  const { currentDomainId } = useDomain();
  const supabase = useMemo(() => createClient(), []);
  const [drafts, setDrafts] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => { fetchDrafts(); }, [fetchDrafts]);

  const handlePublish = async (id: string) => {
    await fetch(`/api/reports/${id}/publish`, { method: 'PUT' });
    fetchDrafts();
  };

  const handleDelete = async (id: string) => {
    await supabase.from('reports').delete().eq('id', id);
    fetchDrafts();
  };

  return (
    <AdminGuard>
      <div>
        <h1 className="text-2xl font-bold text-[#232f3e] mb-6">{t('admin.title')}</h1>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <Link href="/admin/reports/new" className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 hover:border-[#ff9900] hover:shadow transition-all">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#ff9900]/10 text-[#ff9900]">📄</div>
            <span className="font-medium text-[#232f3e]">{t('admin.createReport')}</span>
          </Link>
          <Link href="/admin/news/new" className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 hover:border-[#ff9900] hover:shadow transition-all">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#146eb4]/10 text-[#146eb4]">📰</div>
            <span className="font-medium text-[#232f3e]">{t('admin.createNews')}</span>
          </Link>
          <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 opacity-60">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500">🌐</div>
            <span className="font-medium text-gray-500">{t('admin.manageDomains')}</span>
          </div>
        </div>

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
      </div>
    </AdminGuard>
  );
}
