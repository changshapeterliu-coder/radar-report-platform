'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import {
  Flame,
  Archive,
  TrendingUp,
  Sparkles,
  FileCheck,
  AlertTriangle,
  Newspaper,
  Pin,
  ChevronRight,
  ArrowRight,
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
import CompactTopTopicsTable from '@/components/report/CompactTopTopicsTable';
import { type CategoryCellState } from '@/components/report/TopTopicsTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SpinnerBlock } from '@/components/ui/spinner';
import DisclaimerBanner from '@/components/DisclaimerBanner';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database';
import type { ReportContent, ReportModule } from '@/types/report';
import { isMarkdownModule } from '@/lib/validators/report-schema';
import {
  getDisplayReportContent,
  getDisplayNewsFields,
} from '@/lib/content-display';

/**
 * Dashboard landing page — redesign 2026-05.
 *
 * Information hierarchy (top to bottom in the main column):
 *   1. Page header (h1 + subtitle)
 *   2. Latest report STRIP — "what's the newest report; one click to open"
 *   3. This week's TOP TOPICS — compact 4-column table, tabbed by module
 *      (account suspension / listing takedown). Drops Keywords + Seller
 *      Discussion entirely; those live on the report-detail page (Req 5.1
 *      Content Primacy + Req 6.3 Minimalist Design — dashboard is glance,
 *      report is depth).
 *   4. TREND CHART — last 8 weeks rank trend, supporting context.
 *
 * Sidebar: Hot news (top 3) + Recent news. Hot uses `--primary-soft` tint.
 *
 * What changed vs the previous layout:
 *   - "Recent Reports" 4-card grid replaced by a single strip pointing at
 *     the newest report. `/reports` is one nav-click away for archive.
 *   - Module 1 / Module 2 summary tables merged into a tabbed compact
 *     table (one rendered at a time → ~50px/row vs the previous ~600px).
 *   - Trend chart moved up out of the bottom.
 *
 * Design refs:
 * - ui-design-system.md sec 1.4 (chart palette), sec 3.3 (card chrome),
 *   sec 4.4 (no emoji in UI chrome), sec 9.1 (page header)
 * - power ui-guidelines.md "App Surfaces" — Linear-style restraint,
 *   utility copy, no hero section, viewport budget
 * - power design-guidelines.md 5.1 Content Primacy / 5.2 Information
 *   Hierarchy / 6.3 Minimalist Design / 5.3 Scannability
 */

type ReportRow = Database['public']['Tables']['reports']['Row'];
type NewsRow = Database['public']['Tables']['news']['Row'];
type TopicRankingRow = Database['public']['Tables']['topic_rankings']['Row'];

/**
 * Narrow projection of `topic_canonicals` for the trend chart legend +
 * compact-table category column. Only key + bilingual titles loaded.
 */
type TopicCanonicalLegendRow = Pick<
  Database['public']['Tables']['topic_canonicals']['Row'],
  'canonical_topic_key' | 'canonical_title_zh' | 'canonical_title_en'
>;

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

/** Channel → lucide icon + semantic color intent. */
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
  const [topicCanonicals, setTopicCanonicals] = useState<
    TopicCanonicalLegendRow[]
  >([]);
  const [loading, setLoading] = useState(true);
  // Both the Top Topics table and the Trend Chart are tabbed across the
  // same two modules (0 = suspension, 1 = listing takedown). They share a
  // single state slot so switching one switches the other (Req 3.3
  // consistency).
  const [activeModuleIndex, setActiveModuleIndex] = useState(0);

  const fetchData = useCallback(async () => {
    if (!currentDomainId) return;
    setLoading(true);

    const [reportsRes, newsRes, topicRes, canonicalRes] = await Promise.all([
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
      supabase
        .from('topic_canonicals')
        .select('canonical_topic_key, canonical_title_zh, canonical_title_en')
        .eq('domain_id', currentDomainId),
    ]);

    if (reportsRes.data) setReports(reportsRes.data as ReportRow[]);
    if (newsRes.data) setLatestNews(newsRes.data as NewsRow[]);
    if (topicRes.data) setTopicRankings(topicRes.data as TopicRankingRow[]);
    if (canonicalRes.data)
      setTopicCanonicals(canonicalRes.data as TopicCanonicalLegendRow[]);
    setLoading(false);
  }, [supabase, currentDomainId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Latest report ────────────────────────────────────────
  const latestReport = reports[0] ?? null;
  const latestContent: ReportContent | null = latestReport
    ? getDisplayReportContent(latestReport, i18n.language)
    : null;

  // Topic-count summary for the strip (count across all modules' topTopics).
  const latestTopicCount = useMemo(() => {
    if (!latestContent?.modules) return 0;
    return latestContent.modules.reduce(
      (sum, m) => sum + (Array.isArray(m.topTopics) ? m.topTopics.length : 0),
      0
    );
  }, [latestContent]);

  const latestModuleCount = latestContent?.modules?.length ?? 0;

  const formatPublished = useCallback(
    (iso: string | null) => {
      if (!iso) return '';
      const d = new Date(iso);
      return new Intl.DateTimeFormat(
        i18n.language === 'zh' ? 'zh-CN' : 'en-US',
        { dateStyle: 'medium', timeStyle: 'short' }
      ).format(d);
    },
    [i18n.language]
  );

  // ── Per-module top-topics for the compact tabbed table ───
  const moduleTopics = useMemo<Array<ReportModule | null>>(() => {
    return [0, 1].map((i) => latestContent?.modules?.[i] ?? null);
  }, [latestContent]);

  /**
   * Per-module `CategoryCellState[]` for the compact table, index-aligned
   * with each module's `topTopics`. Joined by `(module_index, rank)` to
   * `topic_rankings` rows scoped to the latest report, then resolved via
   * the canonical dictionary.
   *
   * Drops never produce `topic_rankings` rows (Req 4.2), so any missing
   * row resolves to `unmapped`. Spec ref: Req 17.4.
   */
  const categoryResolutionByModule = useMemo<
    Record<number, CategoryCellState[]>
  >(() => {
    if (!latestReport) return {};
    const sourceModules = latestReport.content?.modules ?? [];
    if (sourceModules.length === 0) return {};

    const canonicalByKey = new Map<
      string,
      { zh: string; en: string | null }
    >();
    topicCanonicals.forEach((c) =>
      canonicalByKey.set(c.canonical_topic_key, {
        zh: c.canonical_title_zh,
        en: c.canonical_title_en,
      })
    );

    const rankingsByModuleAndRank = new Map<string, TopicRankingRow>();
    for (const r of topicRankings) {
      if (r.report_id !== latestReport.id) continue;
      rankingsByModuleAndRank.set(`${r.module_index}:${r.rank}`, r);
    }

    const out: Record<number, CategoryCellState[]> = {};
    sourceModules.forEach((mod, mi) => {
      const topTopics = mod.topTopics ?? [];
      out[mi] = topTopics.map<CategoryCellState>((tt) => {
        const stripped = tt.rank.replace(/✓/g, '').trim();
        const rankNum = parseInt(stripped, 10);
        if (!Number.isFinite(rankNum)) return { kind: 'unmapped' };

        const row = rankingsByModuleAndRank.get(`${mi}:${rankNum}`);
        if (!row || !row.canonical_topic_key) return { kind: 'unmapped' };

        const tc = canonicalByKey.get(row.canonical_topic_key);
        if (!tc) return { kind: 'unmapped' };

        return {
          kind: 'canonical',
          titleZh: tc.zh,
          titleEn: tc.en,
        };
      });
    });
    return out;
  }, [latestReport, topicRankings, topicCanonicals]);

  // ── Trend chart data ─────────────────────────────────────
  const filteredRankings = useMemo(
    () => topicRankings.filter((r) => r.module_index === activeModuleIndex),
    [topicRankings, activeModuleIndex]
  );

  const trendData = useMemo(() => {
    const weekMap = new Map<string, Record<string, string | number>>();
    const weekOrder: string[] = [];

    filteredRankings.forEach((r) => {
      const groupKey = r.canonical_topic_key;
      if (!groupKey) return;
      const week = r.week_label || 'Unknown';
      if (!weekMap.has(week)) {
        weekMap.set(week, { name: week });
        weekOrder.push(week);
      }
      weekMap.get(week)![groupKey] = r.rank;
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

  const resolveLegendLabel = useMemo(() => {
    const lookup = new Map<string, { zh: string; en: string | null }>();
    topicCanonicals.forEach((c) =>
      lookup.set(c.canonical_topic_key, {
        zh: c.canonical_title_zh,
        en: c.canonical_title_en,
      })
    );
    return (key: string): string => {
      const c = lookup.get(key);
      if (!c) return key;
      if (i18n.language === 'zh') return c.zh;
      if (c.en && c.en.trim().length > 0) return c.en;
      return `${c.zh} (Chinese original)`;
    };
  }, [topicCanonicals, i18n.language]);

  // ── News split ───────────────────────────────────────────
  const hotNews = latestNews.slice(0, 3);
  const historyNews = latestNews.slice(3);
  const getNewsTitle = (item: NewsRow) =>
    getDisplayNewsFields(item, i18n.language).title;

  if (loading) return <SpinnerBlock />;

  const hasTrendData = trendData.length > 1 && trendKeys.length > 0;
  const activeTopics =
    moduleTopics[activeModuleIndex] && isMarkdownModule(moduleTopics[activeModuleIndex]!)
      ? moduleTopics[activeModuleIndex]!.topTopics ?? []
      : [];
  const activeCategoryResolution =
    categoryResolutionByModule[activeModuleIndex];

  return (
    <div>
      {/* Page header (Req 9.1) */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">
          {t('dashboard.title')}
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          {/* 1. Latest report strip */}
          {latestReport ? (
            <LatestReportStrip
              report={latestReport}
              moduleCount={latestModuleCount}
              topicCount={latestTopicCount}
              publishedFormatted={formatPublished(latestReport.published_at)}
              onOpen={() => router.push(`/reports/${latestReport.id}`)}
              onAll={() => router.push('/reports')}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-card px-6 py-8 text-center text-sm text-foreground-muted">
              {t('dashboard.latestReport.noReport')}
            </div>
          )}

          {/* 2. This week's top topics — tabbed compact table */}
          {activeTopics.length > 0 && (
            <section
              aria-labelledby="top-topics-heading"
              className="rounded-lg border border-border bg-card p-5 shadow-sm"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2
                  id="top-topics-heading"
                  className="text-base font-semibold text-foreground"
                >
                  {t('dashboard.topTopics.title')}
                </h2>
                <ModuleTabs
                  active={activeModuleIndex}
                  onChange={setActiveModuleIndex}
                  labels={{
                    suspension: t('dashboard.topTopics.tabSuspension'),
                    takedown: t('dashboard.topTopics.tabTakedown'),
                  }}
                />
              </div>

              <CompactTopTopicsTable
                topics={activeTopics}
                categoryResolution={activeCategoryResolution}
              />

              {latestReport && (
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => router.push(`/reports/${latestReport.id}`)}
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    {t('dashboard.topTopics.openFullCta')}
                  </button>
                </div>
              )}
            </section>
          )}

          {/* 3. Trend chart */}
          {hasTrendData && (
            <section
              aria-labelledby="trend-heading"
              className="rounded-lg border border-border bg-card p-5 shadow-sm"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2
                    id="trend-heading"
                    className="flex items-center gap-2 text-base font-semibold text-foreground"
                  >
                    <TrendingUp
                      className="h-5 w-5 text-foreground-muted"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {t('dashboard.trend.title')}
                  </h2>
                  <p className="mt-1 text-xs text-foreground-muted">
                    {t('dashboard.trend.subtitle')}
                  </p>
                </div>
                <ModuleTabs
                  active={activeModuleIndex}
                  onChange={setActiveModuleIndex}
                  labels={{
                    suspension: t('dashboard.trend.tabSuspension'),
                    takedown: t('dashboard.trend.tabTakedown'),
                  }}
                />
              </div>

              <ResponsiveContainer width="100%" height={320}>
                <LineChart
                  data={trendData}
                  margin={{ top: 16, right: 24, left: 12, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border)"
                  />
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
                      resolveLegendLabel(name),
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  {trendKeys.map((key, i) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={resolveLegendLabel(key)}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 3, strokeWidth: 1.5 }}
                      activeDot={{ r: 5 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}
        </div>

        {/* Sidebar — news */}
        <div className="space-y-6">
          {hotNews.length > 0 && (
            <section aria-labelledby="hot-news-heading">
              <div className="mb-3 flex items-center justify-between">
                <SectionHeading
                  id="hot-news-heading"
                  icon={Flame}
                  title={t('dashboard.hotNews')}
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

          {historyNews.length > 0 && (
            <section aria-labelledby="recent-news-heading">
              <SectionHeading
                id="recent-news-heading"
                icon={Archive}
                title={t('dashboard.recentNews')}
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

      <DisclaimerBanner className="mt-10" />
    </div>
  );
}

// ─────────── Local sub-components ───────────

function LatestReportStrip({
  report,
  moduleCount,
  topicCount,
  publishedFormatted,
  onOpen,
  onAll,
}: {
  report: ReportRow;
  moduleCount: number;
  topicCount: number;
  publishedFormatted: string;
  onOpen: () => void;
  onAll: () => void;
}) {
  const { t } = useTranslation();
  const typeLabel =
    report.type === 'regular'
      ? t('reports.filterRegular')
      : t('reports.filterTopic');

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border border-l-[3px] border-l-primary bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
        {report.week_label && (
          <span className="rounded-md bg-primary-soft px-3 py-1.5 text-sm font-semibold tabular-nums text-warning-fg">
            {report.week_label}
          </span>
        )}
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-foreground">
            {report.title}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-foreground-muted">
            <span>
              {t('dashboard.latestReport.published', {
                time: publishedFormatted,
              })}
            </span>
            <span aria-hidden>·</span>
            <span>
              {t('dashboard.latestReport.meta', {
                type: typeLabel,
                moduleCount,
                topicCount,
              })}
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={onAll}>
          {t('dashboard.latestReport.allReports')}
        </Button>
        <Button size="sm" onClick={onOpen}>
          {t('dashboard.latestReport.openReport')}
          <ArrowRight className="ml-1 h-4 w-4" strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  );
}

function ModuleTabs({
  active,
  onChange,
  labels,
}: {
  active: number;
  onChange: (idx: number) => void;
  labels: { suspension: string; takedown: string };
}) {
  return (
    <div
      role="tablist"
      aria-label="Module"
      className="inline-flex overflow-hidden rounded-md border border-border bg-card text-sm shadow-sm"
    >
      {[
        { idx: 0, label: labels.suspension },
        { idx: 1, label: labels.takedown },
      ].map((tab) => (
        <button
          type="button"
          key={tab.idx}
          role="tab"
          aria-selected={active === tab.idx}
          onClick={() => onChange(tab.idx)}
          className={cn(
            'px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
            active === tab.idx
              ? 'bg-muted text-foreground'
              : 'text-foreground-muted hover:bg-muted hover:text-foreground'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function SectionHeading({
  id,
  icon: Icon,
  title,
  accent = false,
}: {
  id?: string;
  icon: typeof TrendingUp;
  title: string;
  accent?: boolean;
}) {
  return (
    <h2
      id={id}
      className="mb-0 flex items-center gap-2 text-base font-semibold text-foreground"
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

interface NewsRowItemProps {
  item: NewsRow;
  title: string;
  emphasis?: boolean;
  onClick: () => void;
}

function NewsRowItem({
  item,
  title,
  emphasis = false,
  onClick,
}: NewsRowItemProps) {
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
