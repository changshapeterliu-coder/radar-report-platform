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
type TopicRankingRow = Database['public']['Tables']['topic_rankings']['Row'];

export default function DashboardPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentDomainId } = useDomain();
  const supabase = useMemo(() => createClient(), []);

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [latestNews, setLatestNews] = useState<NewsRow[]>([]);
  const [topicRankings, setTopicRankings] = useState<TopicRankingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [trendModuleIndex, setTrendModuleIndex] = useState(0);

  const fetchData = useCallback(async () => {
    if (!currentDomainId) return;
    setLoading(true);

    const [reportsRes, newsRes, topicRes] = await Promise.all([
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
        .limit(10),
      supabase
        .from('topic_rankings')
        .select('*')
        .eq('domain_id', currentDomainId)
        .order('created_at', { ascending: true }),
    ]);

    if (reportsRes.data) setReports(reportsRes.data as ReportRow[]);
    if (newsRes.data) setLatestNews(newsRes.data as NewsRow[]);
    if (topicRes.data) setTopicRankings(topicRes.data as TopicRankingRow[]);
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

  // Split news: top 3 as HOT, rest as history
  const hotNews = latestNews.slice(0, 3);
  const historyNews = latestNews.slice(3);

  // Build trend data from topic_rankings table
  const filteredRankings = useMemo(
    () => topicRankings.filter((r) => r.module_index === trendModuleIndex),
    [topicRankings, trendModuleIndex]
  );

  const trendData = useMemo(() => {
    const weekMap = new Map<string, Record<string, string | number>>();
    const weekOrder: string[] = [];

    filteredRankings.forEach((r) => {
      const week = r.week_label || 'Unknown';
      if (!weekMap.has(week)) {
        weekMap.set(week, { name: week });
        weekOrder.push(week);
      }
      weekMap.get(week)![r.topic_label] = r.rank;
    });

    return weekOrder.map((w) => weekMap.get(w)!);
  }, [filteredRankings]);

  const trendKeys = useMemo(() => {
    const keys = new Set<string>();
    trendData.forEach((d) => {
      Object.keys(d).forEach((k) => {
        if (k !== 'name') keys.add(k);
      });
    });
    return Array.from(keys).slice(0, 7);
  }, [trendData]);

  const COLORS = ['#ff9900', '#146eb4', '#232f3e', '#e74c3c', '#27ae60', '#8b5cf6', '#06b6d4'];

  // News icon based on source_channel
  const getNewsIcon = (channel: string) => {
    if (channel === 'AI Insight') return { icon: '🤖', color: 'bg-purple-100 text-purple-700 border-purple-300' };
    if (channel === 'Policy') return { icon: '📋', color: 'bg-blue-100 text-[#146eb4] border-blue-300' };
    if (channel === 'Alert') return { icon: '⚠️', color: 'bg-red-100 text-red-700 border-red-300' };
    return { icon: '📰', color: 'bg-gray-100 text-gray-700 border-gray-300' };
  };

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

      {/* Trend Chart - FULL WIDTH, TOP POSITION */}
      {trendData.length > 1 && trendKeys.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-bold text-[#232f3e]">📈 {t('dashboard.trendView', 'Trend View')}</h2>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden shadow-sm">
              <button
                onClick={() => setTrendModuleIndex(0)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  trendModuleIndex === 0
                    ? 'bg-[#232f3e] text-white'
                    : 'bg-white text-[#232f3e] hover:bg-gray-50'
                }`}
              >
                Latest Suspension Trends
              </button>
              <button
                onClick={() => setTrendModuleIndex(1)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  trendModuleIndex === 1
                    ? 'bg-[#232f3e] text-white'
                    : 'bg-white text-[#232f3e] hover:bg-gray-50'
                }`}
              >
                Latest Listing Takedown Trends
              </button>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <ResponsiveContainer width="100%" height={500}>
              <LineChart data={trendData} margin={{ top: 20, right: 40, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 13, fill: '#232f3e' }} />
                <YAxis
                  reversed
                  domain={[1, 'auto']}
                  tick={{ fontSize: 13, fill: '#232f3e' }}
                  label={{ value: 'Rank', angle: -90, position: 'insideLeft', style: { fontSize: 13, fill: '#232f3e' } }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid #d5dbdb', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                  formatter={(value: number, name: string) => [`#${value}`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                {trendKeys.map((key, i) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2.5}
                    dot={{ r: 5, strokeWidth: 2 }}
                    activeDot={{ r: 7 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content - 2 cols */}
        <div className="lg:col-span-2 space-y-6">
          {/* Recent Reports */}
          <section>
            <h2 className="text-lg font-bold text-[#232f3e] mb-3">📄 {t('dashboard.recentReports')}</h2>
            {reports.length === 0 ? (
              <p className="text-gray-500 text-sm">{t('dashboard.noData')}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {reports.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => router.push(`/reports/${r.id}`)}
                    className="text-left bg-white rounded-lg border border-gray-200 p-4 hover:border-[#ff9900] hover:shadow-md transition-all"
                  >
                    <h3 className="font-semibold text-[#232f3e] text-sm truncate">{r.title}</h3>
                    <div className="flex items-center gap-2 mt-2">
                      {r.week_label && (
                        <span className="inline-block rounded bg-[#ff9900]/10 text-[#ff9900] px-1.5 py-0.5 text-[10px] font-bold">
                          {r.week_label}
                        </span>
                      )}
                      <p className="text-xs text-gray-500">{r.date_range}</p>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
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
              <h2 className="text-lg font-bold text-[#232f3e] mb-3">📊 {t('dashboard.module1Summary')}</h2>
              <div className="bg-white rounded-lg border border-gray-200 p-4 overflow-x-auto shadow-sm">
                <TableRenderer table={module1Table} />
              </div>
            </section>
          )}

          {/* Module 2 Summary Table */}
          {module2Table && (
            <section>
              <h2 className="text-lg font-bold text-[#232f3e] mb-3">📊 {t('dashboard.module2Summary')}</h2>
              <div className="bg-white rounded-lg border border-gray-200 p-4 overflow-x-auto shadow-sm">
                <TableRenderer table={module2Table} />
              </div>
            </section>
          )}
        </div>

        {/* Sidebar - News */}
        <div className="space-y-6">
          {/* HOT News (Top 3) */}
          {hotNews.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold text-[#232f3e]">
                  🔥 <span>Hot News</span>
                </h2>
                <button
                  onClick={() => router.push('/news')}
                  className="text-xs text-[#146eb4] hover:underline"
                >
                  {t('common.viewAll')}
                </button>
              </div>
              <div className="space-y-2">
                {hotNews.map((item, idx) => {
                  const { icon, color } = getNewsIcon(item.source_channel);
                  return (
                    <button
                      key={item.id}
                      onClick={() => router.push(`/news/${item.id}`)}
                      className="w-full text-left bg-gradient-to-br from-[#fff9f0] to-white rounded-lg border-2 border-[#ff9900]/30 p-3 hover:border-[#ff9900] hover:shadow-md transition-all relative"
                    >
                      <div className="absolute -top-1 -left-1 bg-[#ff9900] text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow">
                        {idx + 1}
                      </div>
                      <div className="flex items-start gap-2 pl-5">
                        <span className="text-lg leading-none">{icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {item.is_pinned && (
                              <span className="inline-block rounded-full bg-red-100 text-red-700 px-1.5 py-0.5 text-[10px] font-bold border border-red-300">
                                📌 Pinned
                              </span>
                            )}
                            <span className={`inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
                              {item.source_channel}
                            </span>
                          </div>
                          <h3 className="font-semibold text-[#232f3e] text-sm mt-1 line-clamp-2">{item.title}</h3>
                          <p className="text-xs text-gray-400 mt-1">
                            {new Date(item.published_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* History News */}
          {historyNews.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-[#232f3e] mb-3">📚 Recent News</h2>
              <div className="space-y-2">
                {historyNews.map((item) => {
                  const { icon, color } = getNewsIcon(item.source_channel);
                  return (
                    <button
                      key={item.id}
                      onClick={() => router.push(`/news/${item.id}`)}
                      className="w-full text-left bg-white rounded-lg border border-gray-200 p-3 hover:border-[#146eb4] hover:shadow transition-all"
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-base leading-none mt-0.5">{icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
                              {item.source_channel}
                            </span>
                          </div>
                          <h3 className="font-medium text-[#232f3e] text-sm mt-1 line-clamp-2">{item.title}</h3>
                          <p className="text-xs text-gray-400 mt-1">
                            {new Date(item.published_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
