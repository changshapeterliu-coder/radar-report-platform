'use client';

import {
  useEffect,
  useState,
  use,
  Component,
  type ReactNode,
  type ErrorInfo,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { ReportContent } from '@/types/report';
import type { Database } from '@/types/database';
import ReportRenderer from '@/components/report/ReportRenderer';
import ModuleTabs from '@/components/report/ModuleTabs';
import DisclaimerBanner from '@/components/DisclaimerBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SpinnerBlock } from '@/components/ui/spinner';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    async function fetchReport() {
      try {
        const supabase = createClient();
        const { data, error: fetchErr } = await supabase
          .from('reports')
          .select('*')
          .eq('id', id)
          .single();

        if (fetchErr) {
          setError(fetchErr.message);
          return;
        }
        if (!data) {
          setError('Report not found');
          return;
        }
        setReport(data as ReportRow);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load report');
      } finally {
        setLoading(false);
      }
    }
    fetchReport();
  }, [id]);

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

  const originalContent = report.content as ReportContent;
  const translatedContent = (report as Record<string, unknown>)
    .content_translated as ReportContent | null;

  const currentLang = i18n.language;
  const displayContent =
    currentLang === 'en' && translatedContent
      ? translatedContent
      : originalContent;

  const content = originalContent;
  const modules = displayContent?.modules ?? [];
  const activeModule = modules[activeTab];

  return (
    <div>
      {/* Sticky report header — white chrome, utility copy, outline export. */}
      <header className="no-print sticky top-14 z-30 -mx-4 border-b border-border bg-card px-4 py-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground">
              {displayContent?.title ?? content.title ?? report.title}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge variant={report.type === 'regular' ? 'info' : 'primary'}>
                {report.type === 'regular' ? 'Regular' : 'Topic'}
              </Badge>
              <span className="text-xs text-foreground-muted">
                {displayContent?.dateRange ??
                  content.dateRange ??
                  report.date_range}
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
            <ReportRenderer module={activeModule} />
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
