'use client';

import { useEffect, useState, use, Component, type ReactNode, type ErrorInfo } from 'react';
import { useTranslation } from 'react-i18next';
import { createClient } from '@/lib/supabase/client';
import type { ReportContent } from '@/types/report';
import type { Database } from '@/types/database';
import ReportRenderer from '@/components/report/ReportRenderer';
import ModuleTabs from '@/components/report/ModuleTabs';

type ReportRow = Database['public']['Tables']['reports']['Row'];

/* ─── Error Boundary ─── */

interface EBProps { children: ReactNode; onError: () => void }
interface EBState { hasError: boolean }

class ErrorBoundary extends Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): EBState { return { hasError: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { this.props.onError(); }
  render() { return this.state.hasError ? null : this.props.children; }
}

/* ─── Page Component ─── */

export default function ReportViewerPage({ params }: { params: Promise<{ id: string }> }) {
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

        if (fetchErr) { setError(fetchErr.message); return; }
        if (!data) { setError('Report not found'); return; }
        setReport(data as ReportRow);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load report');
      } finally {
        setLoading(false);
      }
    }
    fetchReport();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#ff9900] border-r-transparent" />
          <p className="mt-3 text-gray-500">Loading report…</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <p className="text-xl font-semibold text-[#232f3e]">
            {error === 'Report not found' ? 'Report Not Found' : 'Error'}
          </p>
          <p className="mt-2 text-gray-500">{error ?? 'The requested report could not be found.'}</p>
        </div>
      </div>
    );
  }

  const originalContent = report.content as ReportContent;
  const translatedContent = (report as Record<string, unknown>).content_translated as ReportContent | null;

  // Determine target language based on global setting + available translation
  // Assumption: original reports are uploaded in ZH, translated to EN
  const currentLang = i18n.language;
  const displayContent = currentLang === 'en' && translatedContent ? translatedContent : originalContent;

  const content = originalContent; // For title/dateRange fallback when no translation
  const modules = displayContent?.modules ?? [];
  const activeModule = modules[activeTab];

  const typeBadge =
    report.type === 'regular' ? (
      <span className="inline-block rounded-full bg-blue-100 text-[#146eb4] border border-blue-300 px-3 py-0.5 text-xs font-bold">
        Regular
      </span>
    ) : (
      <span className="inline-block rounded-full bg-purple-100 text-purple-700 border border-purple-300 px-3 py-0.5 text-xs font-bold">
        Topic
      </span>
    );

  return (
    <div
      className="min-h-screen bg-[#f8f9fa]"
      style={{ '--amazon-primary': '#232f3e', '--amazon-accent': '#ff9900', '--amazon-secondary': '#146eb4' } as React.CSSProperties}
    >
      {/* Header */}
      <header className="bg-gradient-to-b from-[#232f3e] to-[#1a2530] px-4 py-4 shadow sticky top-0 z-50">
        <div className="max-w-[1200px] mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-white/10">
            <div>
              <h1 className="text-white text-xl font-bold">{displayContent?.title ?? content.title ?? report.title}</h1>
              <div className="flex items-center gap-2 mt-1">{typeBadge}</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="bg-[#146eb4] text-white px-4 py-2 rounded text-sm font-medium whitespace-nowrap">
                {displayContent?.dateRange ?? content.dateRange ?? report.date_range}
              </div>
              <button
                onClick={() => window.print()}
                className="no-print rounded bg-white/20 px-3 py-2 text-xs text-white hover:bg-white/30"
              >
                📄 Export PDF
              </button>
            </div>
          </div>

          {modules.length > 0 && (
            <div className="mt-3">
              <ModuleTabs titles={modules.map((m) => m.title)} activeIndex={activeTab} onSelect={setActiveTab} />
            </div>
          )}
        </div>
      </header>

      {/* Body */}
      <main className="max-w-[1200px] mx-auto px-4 py-8">
        {renderError ? (
          <div className="bg-white rounded-lg shadow p-6 overflow-x-auto">
            <p className="text-sm text-gray-500 mb-2">Rendering failed — showing raw data:</p>
            <pre className="text-xs whitespace-pre-wrap break-words">{JSON.stringify(displayContent, null, 2)}</pre>
          </div>
        ) : activeModule ? (
          <ErrorBoundary onError={() => setRenderError(true)}>
            <ReportRenderer module={activeModule} />
          </ErrorBoundary>
        ) : (
          <div className="bg-white rounded-lg shadow p-6 overflow-x-auto">
            <p className="text-sm text-gray-500 mb-2">No module content available — showing raw data:</p>
            <pre className="text-xs whitespace-pre-wrap break-words">{JSON.stringify(displayContent, null, 2)}</pre>
          </div>
        )}
      </main>
    </div>
  );
}
