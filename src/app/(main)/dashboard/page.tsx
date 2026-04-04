'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { createClient } from '@/lib/supabase/client';
import { useDomain } from '@/contexts/DomainContext';
import { TableRenderer } from '@/components/report/ReportRenderer';
import type { Database } from '@/types/database';
import type { ReportContent, ReportTable } from '@/types/report';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

type ReportRow = Database['public']['Tables']['reports']['Row'];
type NewsRow = Database['public']['Tables']['news']['Row'];

export default function DashboardPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentDomainId } = useDomain();
  const supabase = useMemo(() => createClient(), []);

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [latestNews, setLatestNews] = useState<NewsRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!currentDomainId) return;
    setLoading(true);

    const [reportsRes, newsRes] = await Promise.all([
      supabase
        .from('reports')
        .select('*')
        .eq('domain_id', currentDomainId)
        .eq('status', 'published')
        .eq('type', 'regular')
        .order('published_at', { ascending: false })
        .limit(8),
      supabase
        .from('news')
        .select('*')
        .eq('domain_id', currentDomainId)
        .order('is_pinned', { ascending: false })
        .order('published_at', { ascending: false })
        .limit(5),
    ]);

    if (reportsRes.data) setReports(reportsRes.data as ReportRow[]);
    if (newsRes.data) setLatestNews(newsRes.data as NewsRow[]);
    setLoading(false);
  }, [supabase, currentDomainId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Extract summary tables from latest report
  const latestReport = reports[0] ?? null;
  const latestContent = latestReport?.content as ReportContent | null;
  const module1Table: ReportTable | null =
    latestContent?.modules?.[0]?.tables?.[0] ?? null;
  const module2Table: ReportTable | null =
    latestContent?.modules?.[1]?.tables?.[0] ?? null;

  // Build trend data from reports (extract first numeric-like values from module 1 tables)
  const trendData = useMemo(() => {
    return [...reports].reverse().map((r) => {
      const content = r.content as ReportContent;
      const mod1 = content?.modules?.[0];
      const table = mod1?.tables?.[0];
      const point: Record<string, string | number> = {
        name: r.date_range.length > 20 ? r.date_range.slice(0, 20) + '…' : r.date_range,
      };

      if (table?.rows) {
        // Use first 3 rows as trend lines
        table.rows.slice(0, 3).forEach((row, ri) => {
          const label = row.cells[0]?.text || `Item ${ri + 1}`;
          // Try to find a numeric cell
          for (let ci = 1; ci < row.cells.length; ci++) {
            const num = parseFloat(row.cells[ci]?.text?.replace(/[^0-9.-]/g, '') ?? '');
            if (!isNaN(num)) {
              point[label] = num;
              break;
            }
          }
        });
      }
      return point;
    });
  }, [reports]);

  const trendKeys = useMemo(() => {
    const keys = new Set<string>();
    trendData.forEach((d) => {
      Object.keys(d).forEach((k) => {
        if (k !== 'name') keys.add(k);
      });
    });
    return Array.from(keys).slice(0, 5);
  }, [trendData]);

  const COLORS = ['#ff9900', '#146eb4', '#232f3e', '#e74c3c', '#27ae60'];

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#ff9900] border-r-transparent" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#232f3e] mb-6">{t('dashboard.title')}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content - 2 cols */}
        <div className="lg:col-span-2 space-y-6">
          {/* Recent Reports */}
          <section>
            <h2 className="text-lg font-bold text-[#232f3e] mb-3">{t('dashboard.recentReports')}</h2>
            {reports.length === 0 ? (
              <p className="text-gray-500 text-sm">{t('dashboard.noData')}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {reports.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => router.push(`/reports/${r.id}`)}
                    className="text-left bg-white rounded-lg border border-gray-200 p-4 hover:border-[#ff9900] hover:shadow transition-all"
                  >
                    <h3 className="font-medium text-[#232f3e] text-sm truncate">{r.title}</h3>
                    <p className="text-xs text-gray-500 mt-1">{r.date_range}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {r.published_at ? new Date(r.published_at).toLocaleDateString() : ''}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Module 1 Summary Table */}
          {module1Table && (
            <section>
              <h2 className="text-lg font-bold text-[#232f3e] mb-3">{t('dashboard.module1Summary')}</h2>
              <div className="bg-white rounded-lg border border-gray-200 p-4 overflow-x-auto">
                <TableRenderer table={module1Table} />
              </div>
            </section>
          )}

          {/* Module 2 Summary Table */}
          {module2Table && (
            <section>
              <h2 className="text-lg font-bold text-[#232f3e] mb-3">{t('dashboard.module2Summary')}</h2>
              <div className="bg-white rounded-lg border border-gray-200 p-4 overflow-x-auto">
                <TableRenderer table={module2Table} />
              </div>
            </section>
          )}

          {/* Trend Chart */}
          {trendData.length > 1 && trendKeys.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-[#232f3e] mb-3">{t('dashboard.trendView')}</h2>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    {trendKeys.map((key, i) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={COLORS[i % COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
        </div>

        {/* Sidebar - News */}
        <div>
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-[#232f3e]">{t('news.hittingNews')}</h2>
              <button
                onClick={() => router.push('/news')}
                className="text-xs text-[#146eb4] hover:underline"
              >
                {t('common.viewAll')}
              </button>
            </div>
            {latestNews.length === 0 ? (
              <p className="text-gray-500 text-sm">{t('news.noNews')}</p>
            ) : (
              <div className="space-y-2">
                {latestNews.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => router.push(`/news/${item.id}`)}
                    className="w-full text-left bg-white rounded-lg border border-gray-200 p-3 hover:border-[#ff9900] hover:shadow transition-all"
                  >
                    <div className="flex items-center gap-2">
                      {item.is_pinned && (
                        <span className="inline-block rounded-full bg-red-100 text-red-700 px-1.5 py-0.5 text-[10px] font-bold">
                          {t('news.pinned')}
                        </span>
                      )}
                      <h3 className="font-medium text-[#232f3e] text-sm truncate">{item.title}</h3>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(item.published_at).toLocaleDateString()}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
