'use client';

import {
  useEffect,
  useMemo,
  useState,
  use,
  Component,
  type ReactNode,
  type ErrorInfo,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/types/database';
import ReportRenderer from '@/components/report/ReportRenderer';
import ModuleTabs from '@/components/report/ModuleTabs';
import DisclaimerBanner from '@/components/DisclaimerBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SpinnerBlock } from '@/components/ui/spinner';
import {
  getDisplayReportContent,
  getDisplayReportTitle,
  getDisplayReportDateRange,
} from '@/lib/content-display';
import type { CategoryCellState } from '@/components/report/TopTopicsTable';

/**
 * Report viewer page.
 *
 * Design refs:
 * - ui-design-system.md sec 9.1 (page header), sec 9.3 (nav bar style),
 *   sec 3.3 (card conventions)
 * - power design-guidelines.md sec 5.2 Information Hierarchy, sec 3.12 Clear Affordances
 * - power ui-guidelines.md "App Surfaces" — operational workspace, utility copy
 *
 * Header migration: was a dark-navy gradient sticky bar with blue CTA pill +
 * emoji export button. Now a white sticky bar with h1 + Badge + outline
 * Export button, matching the rest of the platform's chrome.
 */

type ReportRow = Database['public']['Tables']['reports']['Row'];

/**
 * Joined `topic_rankings` row carrying its canonical title pair via
 * Supabase's nested-select syntax. The `topic_canonicals` field arrives
 * as `null` (no FK match), a single object, or an array depending on the
 * postgrest plan — normalize on read. (Same pattern as the publish route's
 * AI Insight news block.)
 */
type RankingWithCanonical = {
  module_index: number;
  rank: number;
  canonical_topic_key: string | null;
  topic_canonicals:
    | { canonical_title_zh: string; canonical_title_en: string | null }
    | { canonical_title_zh: string; canonical_title_en: string | null }[]
    | null;
};

/**
 * Strip the cross-engine-confirmed marker (`✓`) from a TopTopic.rank
 * label and parse to an integer. Returns NaN when the label is not a
 * recognizable rank (defensive — the synthesizer schema guarantees a
 * leading integer but we don't want a parse error to crash the page).
 */
function parseTopTopicRank(label: string): number {
  const stripped = label.replace(/✓/g, '').trim();
  const n = parseInt(stripped, 10);
  return Number.isFinite(n) ? n : NaN;
}

// ─── Error Boundary ───

interface EBProps {
  children: ReactNode;
  onError: () => void;
}
interface EBState {
  hasError: boolean;
}

class ErrorBoundary extends Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): EBState {
    return { hasError: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onError();
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

// ─── Page Component ───

export default function ReportViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { i18n } = useTranslation();
  const [report, setReport] = useState<ReportRow | null>(null);
  const [rankings, setRankings] = useState<RankingWithCanonical[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    async function fetchReport() {
      try {
        const supabase = createClient();
        // Parallel: report row + topic_rankings joined to topic_canonicals.
        // The rankings query is best-effort — failure to load the join
        // result must not block report rendering. The Category column
        // simply renders as `unmapped` in that case.
        const [reportRes, rankingsRes] = await Promise.all([
          supabase.from('reports').select('*').eq('id', id).single(),
          supabase
            .from('topic_rankings')
            .select(
              'module_index, rank, canonical_topic_key, topic_canonicals(canonical_title_zh, canonical_title_en)'
            )
            .eq('report_id', id),
        ]);

        if (reportRes.error) {
          setError(reportRes.error.message);
          return;
        }
        if (!reportRes.data) {
          setError('Report not found');
          return;
        }
        setReport(reportRes.data as ReportRow);
        setRankings((rankingsRes.data ?? []) as RankingWithCanonical[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load report');
      } finally {
        setLoading(false);
      }
    }
    fetchReport();
  }, [id]);

  /**
   * Per-module `CategoryCellState[]` array, index-aligned with each
   * module's `topTopics`. Built by joining `topic_rankings` rows (keyed
   * by `(module_index, rank)`) to the canonical title pair.
   *
   * Priority per Req 17.4: canonical wins over dropped wins over unmapped.
   * Drops are NEVER persisted as `topic_rankings` rows (Req 4.2 — drops
   * never produce rankings rows), so any TopTopic without a matching
   * row resolves to `unmapped`. The `dropped` state is reserved for
   * future use cases where drop info is stored alongside the report.
   *
   * Indexing uses the original (untranslated) `report.content.modules`
   * because TopTopic rank labels carry through translation unchanged —
   * the localized `displayContent.modules` keeps the same length and the
   * same `rank` strings, so the array is reusable across languages.
   *
   * Computed BEFORE the early returns to keep hook order stable across
   * loading / error / success states.
   */
  const categoryResolutionByModule = useMemo<
    Record<number, CategoryCellState[]>
  >(() => {
    const sourceModules = report?.content?.modules ?? [];
    if (sourceModules.length === 0) return {};

    // Index the joined rankings by (module_index, rank) for O(1) lookup.
    const rankingsByModuleAndRank = new Map<string, RankingWithCanonical>();
    for (const r of rankings) {
      rankingsByModuleAndRank.set(`${r.module_index}:${r.rank}`, r);
    }

    const out: Record<number, CategoryCellState[]> = {};
    sourceModules.forEach((mod, mi) => {
      const topTopics = mod.topTopics ?? [];
      out[mi] = topTopics.map<CategoryCellState>((tt) => {
        const rankNum = parseTopTopicRank(tt.rank);
        if (!Number.isFinite(rankNum)) return { kind: 'unmapped' };

        const row = rankingsByModuleAndRank.get(`${mi}:${rankNum}`);
        if (!row || !row.canonical_topic_key) return { kind: 'unmapped' };

        // Postgrest-nested-select can return either a single object or a
        // single-element array depending on the FK plan — normalize.
        const tc = Array.isArray(row.topic_canonicals)
          ? row.topic_canonicals[0]
          : row.topic_canonicals;
        if (!tc) return { kind: 'unmapped' };

        return {
          kind: 'canonical',
          titleZh: tc.canonical_title_zh,
          titleEn: tc.canonical_title_en,
        };
      });
    });
    return out;
  }, [report, rankings]);

  if (loading) return <SpinnerBlock label="Loading report" />;

  if (error || !report) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold text-foreground">
            {error === 'Report not found' ? 'Report Not Found' : 'Error'}
          </p>
          <p className="mt-2 text-sm text-foreground-muted">
            {error ?? 'The requested report could not be found.'}
          </p>
        </div>
      </div>
    );
  }

  const displayContent = getDisplayReportContent(report, i18n.language);
  const displayTitle = getDisplayReportTitle(report, i18n.language);
  const displayDateRange = getDisplayReportDateRange(report, i18n.language);

  const modules = displayContent?.modules ?? [];
  const activeModule = modules[activeTab];

  return (
    <div>
      {/* Sticky report header — white chrome, utility copy, outline export. */}
      <header className="no-print sticky top-14 z-30 -mx-4 border-b border-border bg-card px-4 py-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground">
              {displayTitle || report.title}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge variant={report.type === 'regular' ? 'info' : 'primary'}>
                {report.type === 'regular' ? 'Regular' : 'Topic'}
              </Badge>
              <span className="text-xs text-foreground-muted">
                {displayDateRange || report.date_range}
              </span>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
            >
              <Printer className="h-4 w-4" strokeWidth={1.75} />
              Export PDF
            </Button>
          </div>
        </div>

        {modules.length > 0 && (
          <div className="mt-4">
            <ModuleTabs
              titles={modules.map((m) => m.title)}
              activeIndex={activeTab}
              onSelect={setActiveTab}
            />
          </div>
        )}
      </header>

      {/* Body */}
      <main className="pt-6">
        <DisclaimerBanner className="mb-6" />
        {renderError ? (
          <div className="overflow-x-auto rounded-lg border border-border bg-card p-6">
            <p className="mb-2 text-sm text-foreground-muted">
              Rendering failed — showing raw data:
            </p>
            <pre className="whitespace-pre-wrap break-words text-xs text-foreground">
              {JSON.stringify(displayContent, null, 2)}
            </pre>
          </div>
        ) : activeModule ? (
          <ErrorBoundary onError={() => setRenderError(true)}>
            <ReportRenderer
              module={activeModule}
              moduleIndex={activeTab}
              categoryResolutionByModule={categoryResolutionByModule}
            />
          </ErrorBoundary>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card p-6">
            <p className="mb-2 text-sm text-foreground-muted">
              No module content available — showing raw data:
            </p>
            <pre className="whitespace-pre-wrap break-words text-xs text-foreground">
              {JSON.stringify(displayContent, null, 2)}
            </pre>
          </div>
        )}
      </main>
    </div>
  );
}
