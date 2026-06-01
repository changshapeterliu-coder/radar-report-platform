'use client';

import {
  useMemo,
  useState,
  Component,
  type ReactNode,
  type ErrorInfo,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import ReportRenderer from '@/components/report/ReportRenderer';
import ReportOutline from '@/components/report/ReportOutline';
import { ExportPdfButton } from '@/components/report/ExportPdfButton';
import { EmailReportButton } from '@/components/report/EmailReportButton';
import DisclaimerBanner from '@/components/DisclaimerBanner';
import { Badge } from '@/components/ui/badge';
import {
  deriveSections,
  deriveFilenameBase,
  canExport,
  type Section,
} from '@/lib/report-export';
import { useRole } from '@/hooks/useRole';
import {
  getDisplayReportContent,
  getDisplayReportTitle,
  getDisplayReportDateRange,
} from '@/lib/content-display';
import type { CategoryCellState } from '@/components/report/TopTopicsTable';
import type { ReportViewerData, RankingWithCanonical } from './loaders';

/**
 * Strip the cross-engine-confirmed marker (`✓`) from a TopTopic.rank
 * label and parse to an integer.
 */
function parseTopTopicRank(label: string): number {
  const stripped = label.replace(/✓/g, '').trim();
  const n = parseInt(stripped, 10);
  return Number.isFinite(n) ? n : NaN;
}

interface EBProps {
  children: ReactNode;
  onError?: () => void;
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
    this.props.onError?.();
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

export default function ReportViewerClient({
  data,
}: {
  data: ReportViewerData;
}) {
  const { i18n } = useTranslation();
  const { isAdmin } = useRole();
  const { report, rankings } = data;

  const [renderError, setRenderError] = useState(false);

  const categoryResolutionByModule = useMemo<
    Record<number, CategoryCellState[]>
  >(() => {
    const sourceModules = report.content?.modules ?? [];
    if (sourceModules.length === 0) return {};

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

  const displayContent = getDisplayReportContent(report, i18n.language);
  const displayTitle = getDisplayReportTitle(report, i18n.language);
  const displayDateRange = getDisplayReportDateRange(report, i18n.language);

  const modules = displayContent?.modules ?? [];

  // Single source of truth for the outline entries + body section anchors.
  const sections = useMemo<Section[]>(() => deriveSections(modules), [modules]);

  const showOutline = sections.length > 1;

  const filenameBase = deriveFilenameBase({
    title: displayTitle || report.title,
    dateRange: displayDateRange || report.date_range || '',
    reportId: report.id,
  });

  return (
    <div>
      <header className="no-print -mx-4 border-b border-border bg-card px-4 py-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
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
            {canExport(report.status, isAdmin) && (
              <ExportPdfButton filenameBase={filenameBase} />
            )}
            <EmailReportButton
              reportId={report.id}
              title={report.title}
              status={report.status}
            />
          </div>
        </div>
      </header>

      <div
        className={cn(
          'pt-6',
          showOutline && 'lg:grid lg:grid-cols-[240px_1fr] lg:gap-10'
        )}
      >
        {showOutline && <ReportOutline sections={sections} />}

        <main>
          <DisclaimerBanner className="no-print mb-6" />
          {renderError ? (
            <div className="overflow-x-auto rounded-lg border border-border bg-card p-6">
              <p className="mb-2 text-sm text-foreground-muted">
                Rendering failed — showing raw data:
              </p>
              <pre className="whitespace-pre-wrap break-words text-xs text-foreground">
                {JSON.stringify(displayContent, null, 2)}
              </pre>
            </div>
          ) : modules.length > 0 ? (
            <ErrorBoundary onError={() => setRenderError(true)}>
              <div className="space-y-12">
                {modules.map((m, i) => (
                  <section
                    key={i}
                    id={`module-${i}`}
                    className="scroll-mt-[76px]"
                  >
                    <ErrorBoundary>
                      <ReportRenderer
                        module={m}
                        moduleIndex={i}
                        categoryResolutionByModule={categoryResolutionByModule}
                      />
                    </ErrorBoundary>
                  </section>
                ))}
              </div>
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

          <DisclaimerBanner className="print-only mt-8" />
        </main>
      </div>
    </div>
  );
}
