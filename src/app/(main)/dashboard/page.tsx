'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  Flame,
  Archive,
  TrendingUp,
  Sparkles,
  FileCheck,
  AlertTriangle,
  Newspaper,
  Pin,
  ChevronRight,
} from 'lucide-react';
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
import { createClient } from '@/lib/supabase/client';
import { useDomain } from '@/contexts/DomainContext';
import { TableRenderer } from '@/components/report/ReportRenderer';
import TopTopicsTable from '@/components/report/TopTopicsTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SpinnerBlock } from '@/components/ui/spinner';
import DisclaimerBanner from '@/components/DisclaimerBanner';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database';
import type { ReportContent, ReportTable, ReportModule } from '@/types/report';
import { isMarkdownModule } from '@/lib/validators/report-schema';
import {
  getDisplayReportContent,
  getDisplayNewsFields,
} from '@/lib/content-display';

/**
 * Dashboard landing page.
 *
 * Design refs:
 * - ui-design-system.md sec 4.4 (no emoji in UI chrome), sec 9.1 (page header),
 *   sec 3.3 (card conventions), sec 1.4 (chart palette)
 * - power design-guidelines.md sec 5.2 Information Hierarchy, sec 6.2 Emphasis,
 *   sec 6.3 Minimalist Design, sec 3.3 Consistency
 * - power ui-guidelines.md "App Surfaces" — Linear-style restraint, utility
 *   copy, no hero section on operational workspaces, viewport budget
 *
 * Information hierarchy (top to bottom):
 *   1. Page header (h1)
 *   2. Recent Reports (2-col grid, main column)
 *   3. Summary tables (Module 1 + Module 2 of latest report)
 *   4. Hot News + Recent News (sidebar)
 *   5. Trend Chart (full-width, at the bottom — supporting reference, not hero)
 */

type ReportRow = Database['public']['Tables']['reports']['Row'];
type NewsRow = Database['public']['Tables']['news']['Row'];
type TopicRankingRow = Database['public']['Tables']['topic_rankings']['Row'];

/**
 * Chart palette from ui-design-system.md sec 1.4.
 * Order: primary (orange) first for the #1 series, then cool grays/blues,
 * then spectral fills for >3-series cases. Never #e74c3c (clashes with --danger).
 */
const CHART_COLORS = [
  '#ff9900', // --primary
  '#146eb4', // --info
  '#374151', // neutral-700
  '#10b981', // --success
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#d97706', // amber-600
];

/**
 * Channel -> lucide icon + semantic color intent.
 * Was emoji; switched per ui-design-system sec 4.4.
 */
function getChannelIcon(channel: string) {
  switch (channel) {
    case 'AI Insight':
      return { Icon: Sparkles, tone: 'text-violet-600' };
    case 'Policy':
      return { Icon: FileCheck, tone: 'text-info' };
    case 'Alert':
      return { Icon: AlertTriangle, tone: 'text-danger' };
    default:
      return { Icon: Newspaper, tone: 'text-foreground-muted' };
  }
}

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
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

  // Extract summary tables from latest report — pick translated content
  // when UI language is English so Module1/Module2 tables follow the switch.
  const latestReport = reports[0] ?? null;
  const latestContent: ReportContent | null = latestReport
    ? getDisplayReportContent(latestReport, i18n.language)
    : null;
  const module1: ReportModule | null = latestContent?.modules?.[0] ?? null;
  const module2: ReportModule | null = latestContent?.modules?.[1] ?? null;
  const module1Table: ReportTable | null = module1?.tables?.[0] ?? null;
  const module2Table: ReportTable | null = module2?.tables?.[0] ?? null;

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

  // Follow global language for news title/summary via shared helper
  const getNewsTitle = (item: NewsRow) =>
    getDisplayNewsFields(item, i18n.language).title;

  if (loading) return <SpinnerBlock />;

  const hasTrendData = trendData.length > 1 && trendKeys.length > 0;

  return (
    <div>
      {/* Page header per ui-design-system sec 9.1 */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">
          {t('dashboard.title')}
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main column — reports + summary tables */}
        <div className="space-y-6 lg:col-span-2">
          {/* Recent Reports */}
          <section aria-labelledby="recent-reports-heading">
            <SectionHeading
              id="recent-reports-heading"
              icon={FileText}
              title={t('dashboard.recentReports')}
            />
            {reports.length === 0 ? (
              <EmptyBlock icon={FileText} label={t('dashboard.noData')} />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {reports.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    onClick={() => router.push(`/reports/${r.id}`)}
                    className="group flex flex-col rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-border-strong hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    <h3 className="truncate text-sm font-semibold text-foreground">
                      {r.title}
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {r.week_label && (
                        <Badge variant="outline">{r.week_label}</Badge>
                      )}
                      <span className="text-xs text-foreground-muted">
                        {r.date_range}
                      </span>
                    </div>
                    <span className="mt-1 text-xs text-foreground-subtle">
                      {r.published_at
                        ? new Date(r.published_at).toLocaleDateString()
                        : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Module 1 Summary */}
          {module1 &&
            (isMarkdownModule(module1)
              ? (module1.topTopics ?? []).length > 0
              : !!module1Table) && (
              <section aria-labelledby="module1-heading">
                <SectionHeading
                  id="module1-heading"
                  icon={TrendingUp}
                  title={t('dashboard.module1Summary')}
                />
                <div className="overflow-x-auto rounded-lg border border-border bg-card p-4 shadow-sm">
                  {isMarkdownModule(module1) ? (
                    <TopTopicsTable topics={module1.topTopics!} />
                  ) : (
                    module1Table && <TableRenderer table={module1Table} />
                  )}
                </div>
              </section>
            )}

          {/* Module 2 Summary */}
          {module2 &&
            (isMarkdownModule(module2)
              ? (module2.topTopics ?? []).length > 0
              : !!module2Table) && (
              <section aria-labelledby="module2-heading">
                <SectionHeading
                  id="module2-heading"
                  icon={TrendingUp}
                  title={t('dashboard.module2Summary')}
                />
                <div className="overflow-x-auto rounded-lg border border-border bg-card p-4 shadow-sm">
                  {isMarkdownModule(module2) ? (
                    <TopTopicsTable topics={module2.topTopics!} />
                  ) : (
                    module2Table && <TableRenderer table={module2Table} />
                  )}
                </div>
              </section>
            )}
        </div>

        {/* Sidebar — news */}
        <div className="space-y-6">
          {/* Hot News (Top 3) — subtle primary tint, same row chrome as Recent News */}
          {hotNews.length > 0 && (
            <section aria-labelledby="hot-news-heading">
              <div className="mb-3 flex items-center justify-between">
                <SectionHeading
                  id="hot-news-heading"
                  icon={Flame}
                  title="Hot News"
                  accent
                />
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => router.push('/news')}
                >
                  {t('common.viewAll')}
                </Button>
              </div>
              <ul className="space-y-2">
                {hotNews.map((item) => (
                  <NewsRowItem
                    key={item.id}
                    item={item}
                    title={getNewsTitle(item)}
                    emphasis
                    onClick={() => router.push(`/news/${item.id}`)}
                  />
                ))}
              </ul>
            </section>
          )}

          {/* Recent News */}
          {historyNews.length > 0 && (
            <section aria-labelledby="recent-news-heading">
              <SectionHeading
                id="recent-news-heading"
                icon={Archive}
                title="Recent News"
              />
              <ul className="space-y-2">
                {historyNews.map((item) => (
                  <NewsRowItem
                    key={item.id}
                    item={item}
                    title={getNewsTitle(item)}
                    onClick={() => router.push(`/news/${item.id}`)}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {/* Trend Chart — full-width, bottom position.
          Supporting reference, not a hero. Compact height per power
          "viewport budget" + design-guidelines sec 5.2 Info Hierarchy. */}
      {hasTrendData && (
        <section aria-labelledby="trend-heading" className="mt-10">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <SectionHeading
              id="trend-heading"
              icon={TrendingUp}
              title={t('dashboard.trendView', 'Trend View')}
            />
            <div
              role="tablist"
              aria-label="Trend module selector"
              className="inline-flex overflow-hidden rounded-md border border-border bg-card text-sm shadow-sm"
            >
              {[
                { idx: 0, label: 'Suspension Trends' },
                { idx: 1, label: 'Listing Takedown' },
              ].map((tab) => (
                <button
                  type="button"
                  key={tab.idx}
                  role="tab"
                  aria-selected={trendModuleIndex === tab.idx}
                  onClick={() => setTrendModuleIndex(tab.idx)}
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                    trendModuleIndex === tab.idx
                      ? 'bg-muted text-foreground'
                      : 'text-foreground-muted hover:bg-muted hover:text-foreground'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <ResponsiveContainer width="100%" height={360}>
              <LineChart
                data={trendData}
                margin={{ top: 16, right: 24, left: 12, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: 'var(--foreground-muted)' }}
                  stroke="var(--border-strong)"
                />
                <YAxis
                  reversed
                  domain={[1, 'auto']}
                  tick={{ fontSize: 12, fill: 'var(--foreground-muted)' }}
                  stroke="var(--border-strong)"
                  label={{
                    value: 'Rank',
                    angle: -90,
                    position: 'insideLeft',
                    style: {
                      fontSize: 12,
                      fill: 'var(--foreground-muted)',
                    },
                  }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--card)',
                    boxShadow:
                      '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
                    fontSize: 12,
                  }}
                  formatter={(value: number, name: string) => [
                    `#${value}`,
                    name,
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                {trendKeys.map((key, i) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 1.5 }}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <DisclaimerBanner className="mt-10" />
    </div>
  );
}

// ─────────── Local sub-components ───────────

function SectionHeading({
  id,
  icon: Icon,
  title,
  accent = false,
}: {
  id?: string;
  icon: typeof FileText;
  title: string;
  accent?: boolean;
}) {
  return (
    <h2
      id={id}
      className={cn(
        'mb-3 flex items-center gap-2 text-lg font-semibold',
        accent ? 'text-foreground' : 'text-foreground'
      )}
    >
      <Icon
        className={cn(
          'h-5 w-5',
          accent ? 'text-primary' : 'text-foreground-muted'
        )}
        strokeWidth={1.75}
        aria-hidden
      />
      {title}
    </h2>
  );
}

function EmptyBlock({
  icon: Icon,
  label,
}: {
  icon: typeof FileText;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card py-10 text-center">
      <Icon
        className="mb-2 h-8 w-8 text-foreground-subtle"
        strokeWidth={1.5}
        aria-hidden
      />
      <p className="text-sm text-foreground-muted">{label}</p>
    </div>
  );
}

interface NewsRowItemProps {
  item: NewsRow;
  title: string;
  emphasis?: boolean;
  onClick: () => void;
}

function NewsRowItem({ item, title, emphasis = false, onClick }: NewsRowItemProps) {
  const { Icon, tone } = getChannelIcon(item.source_channel);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'group flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          emphasis
            ? 'border-primary/20 bg-primary-soft/40 hover:border-primary/40'
            : 'border-border bg-card hover:border-border-strong hover:bg-muted/40'
        )}
      >
        <Icon
          className={cn('mt-0.5 h-4 w-4 flex-shrink-0', tone)}
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {item.is_pinned && (
              <Badge variant="danger">
                <Pin className="h-2.5 w-2.5" strokeWidth={2} />
                Pinned
              </Badge>
            )}
            <Badge variant="outline">{item.source_channel}</Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-sm font-medium text-foreground">
            {title}
          </p>
          <p className="mt-0.5 text-xs text-foreground-subtle">
            {new Date(item.published_at).toLocaleDateString()}
          </p>
        </div>
        <ChevronRight
          className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-foreground-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-foreground-muted"
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
    </li>
  );
}
