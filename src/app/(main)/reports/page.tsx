'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { createClient } from '@/lib/supabase/client';
import { useDomain } from '@/contexts/DomainContext';
import type { Database } from '@/types/database';

type ReportRow = Database['public']['Tables']['reports']['Row'];

const PAGE_SIZE = 10;

export default function ReportsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentDomainId } = useDomain();
  const supabase = useMemo(() => createClient(), []);

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState<'all' | 'regular' | 'topic'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const fetchReports = useCallback(async () => {
    if (!currentDomainId) return;
    setLoading(true);

    try {
      if (searchQuery.trim()) {
        // Use RPC search
        const { data, error } = await supabase.rpc('search_reports', {
          search_query: searchQuery.trim(),
          domain_filter: currentDomainId,
        });
        if (!error && data) {
          let filtered = data as ReportRow[];
          if (typeFilter !== 'all') {
            filtered = filtered.filter((r) => r.type === typeFilter);
          }
          setTotalCount(filtered.length);
          setReports(filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));
        }
      } else {
        let query = supabase
          .from('reports')
          .select('*', { count: 'exact' })
          .eq('domain_id', currentDomainId)
          .eq('status', 'published')
          .order('published_at', { ascending: false });

        if (typeFilter !== 'all') {
          query = query.eq('type', typeFilter);
        }

        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        query = query.range(from, to);

        const { data, error, count } = await query;
        if (!error) {
          setReports((data ?? []) as ReportRow[]);
          setTotalCount(count ?? 0);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [supabase, currentDomainId, typeFilter, searchQuery, page]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Reset page when filter/search changes
  useEffect(() => {
    setPage(0);
  }, [typeFilter, searchQuery, currentDomainId]);

  const handleSearch = () => {
    setSearchQuery(searchInput);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#232f3e] mb-6">{t('reports.title')}</h1>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex-1">
          <div className="flex gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('reports.search')}
              className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-1 focus:ring-[#ff9900]"
            />
            <button
              onClick={handleSearch}
              className="rounded bg-[#ff9900] px-4 py-2 text-sm font-medium text-white hover:bg-[#e88b00]"
            >
              {t('reports.search').replace('...', '')}
            </button>
          </div>
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as 'all' | 'regular' | 'topic')}
          className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#ff9900] focus:outline-none"
        >
          <option value="all">{t('reports.filterAll')}</option>
          <option value="regular">{t('reports.filterRegular')}</option>
          <option value="topic">{t('reports.filterTopic')}</option>
        </select>
      </div>

      {/* Report List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#ff9900] border-r-transparent" />
        </div>
      ) : reports.length === 0 ? (
        <p className="text-center text-gray-500 py-12">{t('reports.noReports')}</p>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <button
              key={report.id}
              onClick={() => router.push(`/reports/${report.id}`)}
              className="w-full text-left bg-white rounded-lg border border-gray-200 p-4 hover:border-[#ff9900] hover:shadow transition-all"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-[#232f3e] truncate">{report.title}</h3>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${
                        report.type === 'regular'
                          ? 'bg-blue-100 text-[#146eb4] border border-blue-300'
                          : 'bg-purple-100 text-purple-700 border border-purple-300'
                      }`}
                    >
                      {report.type === 'regular' ? t('reports.filterRegular') : t('reports.filterTopic')}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{report.date_range}</p>
                </div>
                <p className="text-xs text-gray-400 whitespace-nowrap">
                  {report.published_at ? new Date(report.published_at).toLocaleDateString() : ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50"
          >
            ←
          </button>
          <span className="text-sm text-gray-600">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50"
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
