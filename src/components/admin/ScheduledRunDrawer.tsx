'use client';

import { useEffect, useState } from 'react';

interface ScheduledRunDetail {
  id: string;
  domain_id: string;
  trigger_type: 'scheduled' | 'manual';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'partial';
  coverage_window_start: string;
  coverage_window_end: string;
  week_label: string;
  draft_report_id: string | null;
  failure_reason: string | null;
  gemini_output: unknown;
  kimi_output: unknown;
  synthesizer_output: unknown;
  duration_ms: number | null;
  triggered_at: string;
  completed_at: string | null;
}

export interface ScheduledRunDrawerProps {
  runId: string | null;
  onClose: () => void;
  onRetry: (runId: string) => void;
}

function formatShanghai(iso: string): string {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} CST`;
}

function statusClass(status: ScheduledRunDetail['status']): string {
  switch (status) {
    case 'succeeded':
      return 'text-green-600';
    case 'failed':
      return 'text-red-600';
    case 'partial':
      return 'text-orange-600';
    case 'queued':
    case 'running':
      return 'text-blue-600';
    default:
      return 'text-gray-600';
  }
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2 border-b border-gray-100 last:border-b-0">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <span className="text-sm text-[#232f3e] break-words">{children}</span>
    </div>
  );
}

function ExpandableSection({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-gray-200 pt-3 mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-sm font-semibold text-[#232f3e] hover:text-[#ff9900]"
      >
        <span>{title}</span>
        <span className="text-xs text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <pre className="mt-2 max-h-96 overflow-auto rounded border border-gray-200 bg-gray-50 p-3 text-xs font-mono whitespace-pre-wrap break-words">
          {value == null ? 'null' : prettyJson(value)}
        </pre>
      )}
    </div>
  );
}

export function ScheduledRunDrawer({ runId, onClose, onRetry }: ScheduledRunDrawerProps) {
  const [data, setData] = useState<ScheduledRunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/scheduled-runs/${encodeURIComponent(runId)}`, {
          cache: 'no-store',
        });
        if (res.status === 404) throw new Error('Run not found');
        if (!res.ok) throw new Error(`Failed to load run (${res.status})`);
        const json = await res.json();
        if (!cancelled) setData(json?.data as ScheduledRunDetail);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const open = runId !== null;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/20"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed top-0 right-0 h-full w-full sm:w-[500px] bg-white border-l border-gray-200 overflow-y-auto z-40 transition-transform ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {open && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-[#232f3e]">
                Run {runId ? runId.slice(0, 8) : ''}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {loading && <p className="text-sm text-gray-500">Loading run...</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}

            {data && (
              <div className="space-y-1">
                <Row label="Triggered At (Asia/Shanghai)">{formatShanghai(data.triggered_at)}</Row>
                <Row label="Trigger Type">{data.trigger_type}</Row>
                <Row label="Status">
                  <span className={`font-medium ${statusClass(data.status)}`}>{data.status}</span>
                </Row>
                <Row label="Coverage Window (Asia/Shanghai)">
                  {formatShanghai(data.coverage_window_start)} ~{' '}
                  {formatShanghai(data.coverage_window_end)}
                </Row>
                <Row label="Week Label">{data.week_label}</Row>
                <Row label="Duration">
                  {data.duration_ms != null ? `${Math.round(data.duration_ms / 1000)}s` : '—'}
                </Row>
                <Row label="Draft">
                  {data.draft_report_id ? (
                    <a
                      href={`/admin/reports/${data.draft_report_id}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#146eb4] hover:underline"
                    >
                      Open draft in new tab ↗
                    </a>
                  ) : (
                    '—'
                  )}
                </Row>
                <Row label="Failure Reason">
                  {data.failure_reason ? (
                    <span className="whitespace-pre-wrap">{data.failure_reason}</span>
                  ) : (
                    '—'
                  )}
                </Row>

                <ExpandableSection title="Gemini Output" value={data.gemini_output} />
                <ExpandableSection title="Kimi Output" value={data.kimi_output} />
                <ExpandableSection title="Synthesizer Output" value={data.synthesizer_output} />

                {(data.status === 'failed' || data.status === 'partial') && (
                  <div className="pt-6">
                    <button
                      type="button"
                      onClick={() => onRetry(data.id)}
                      className="rounded bg-[#ff9900] px-4 py-2 text-sm font-medium text-white hover:bg-[#e88b00]"
                    >
                      Retry this run
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
