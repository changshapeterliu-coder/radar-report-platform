'use client';

import { useEffect, useState, use, Component, type ReactNode, type ErrorInfo } from 'react';
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
  const [report, setReport] = useState<ReportRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [renderError, setRenderError] = useState(false);
  const [translatedContent, setTranslatedContent] = useState<ReportContent | null>(null);
  const [translating, setTranslating] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);

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

  const content = report.content as ReportContent;
  const preTranslated = (report as Record<string, unknown>).content_translated as ReportContent | null;
  const displayContent = showTranslation && (translatedContent || preTranslated) ? (translatedContent || preTranslated) : content;
  const modules = displayContent?.modules ?? [];
  const activeModule = modules[activeTab];

  const handleTranslate = async (targetLang: 'zh' | 'en') => {
    // If pre-translated version exists, use it instantly
    if (preTranslated && !translatedContent) {
      setTranslatedContent(preTranslated);
      setShowTranslation(true);
      return;
    }
    setTranslating(true);
    try {
      const res = await fetch('/api/ai/translate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, targetLang }),
      });
      if (res.ok) {
        const translated = await res.json();
        setTranslatedContent(translated);
        setShowTranslation(true);
      }
    } catch { /* ignore */ }
    setTranslating(false);
  };

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
              <h1 className="text-white text-xl font-bold">{content.title ?? report.title}</h1>
              <div className="flex items-center gap-2 mt-1">{typeBadge}</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="bg-[#146eb4] text-white px-4 py-2 rounded text-sm font-medium whitespace-nowrap">
                {content.dateRange ?? report.date_range}
              </div>
              {showTranslation ? (
                <button
                  onClick={() => setShowTranslation(false)}
                  className="rounded bg-white/20 px-3 py-2 text-xs text-white hover:bg-white/30"
                >
                  Original
                </button>
              ) : (
                <div className="flex gap-1">
                  <button
                    onClick={() => handleTranslate('zh')}
                    disabled={translating}
                    className="rounded bg-[#ff9900] px-3 py-2 text-xs text-white hover:bg-[#e88b00] disabled:opacity-50"
                  >
                    {translating ? '翻译中...' : '译中文'}
                  </button>
                  <button
                    onClick={() => handleTranslate('en')}
                    disabled={translating}
                    className="rounded bg-[#ff9900] px-3 py-2 text-xs text-white hover:bg-[#e88b00] disabled:opacity-50"
                  >
                    {translating ? 'Translating...' : 'To EN'}
                  </button>
                </div>
              )}
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
            <pre className="text-xs whitespace-pre-wrap break-words">{JSON.stringify(content, null, 2)}</pre>
          </div>
        ) : activeModule ? (
          <ErrorBoundary onError={() => setRenderError(true)}>
            <ReportRenderer module={activeModule} />
          </ErrorBoundary>
        ) : (
          <div className="bg-white rounded-lg shadow p-6 overflow-x-auto">
            <p className="text-sm text-gray-500 mb-2">No module content available — showing raw data:</p>
            <pre className="text-xs whitespace-pre-wrap break-words">{JSON.stringify(content, null, 2)}</pre>
          </div>
        )}
      </main>
    </div>
  );
}
