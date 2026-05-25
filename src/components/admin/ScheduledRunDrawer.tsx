'use client';

import { useEffect, useState } from 'react';
import { X, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SpinnerBlock } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

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
  onRetry: (runId: string, force: boolean) => void;
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

function statusVariant(
  status: ScheduledRunDetail['status']
): 'success' | 'danger' | 'warning' | 'info' | 'default' {
  switch (status) {
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'danger';
    case 'partial':
      return 'warning';
    case 'queued':
    case 'running':
      return 'info';
    default:
      return 'default';
  }
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0">
      <span className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
        {label}
      </span>
      <span className="break-words text-sm text-foreground">{children}</span>
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
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-sm font-semibold text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
      >
        <span>{title}</span>
        {open ? (
          <ChevronUp
            className="h-4 w-4 text-foreground-muted"
            strokeWidth={1.75}
          />
        ) : (
          <ChevronDown
            className="h-4 w-4 text-foreground-muted"
            strokeWidth={1.75}
          />
        )}
      </button>
      {open && (
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/60 p-3 font-mono text-xs text-foreground">
          {value == null ? 'null' : prettyJson(value)}
        </pre>
      )}
    </div>
  );
}

export function ScheduledRunDrawer({
  runId,
  onClose,
  onRetry,
}: ScheduledRunDrawerProps) {
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
        const res = await fetch(
          `/api/admin/scheduled-runs/${encodeURIComponent(runId)}`,
          { cache: 'no-store' }
        );
        if (res.status === 404) throw new Error('Run not found');
        if (!res.ok) throw new Error(`Failed to load run (${res.status})`);
        const json = await res.json();
        if (!cancelled) setData(json?.data as ScheduledRunDetail);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Failed to load');
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
          className="fixed inset-0 z-30 bg-foreground/20"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          'fixed right-0 top-0 z-40 h-full w-full overflow-y-auto border-l border-border bg-card transition-transform sm:w-[500px]',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {open && (
          <div className="p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">
                Run {runId ? runId.slice(0, 8) : ''}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label="Close"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </Button>
            </div>

            {loading && <SpinnerBlock label="Loading run" />}
            {error && <p className="text-sm text-danger-fg">{error}</p>}

            {data && (
              <div className="space-y-1">
                <Row label="Triggered At (Asia/Shanghai)">
                  {formatShanghai(data.triggered_at)}
                </Row>
                <Row label="Trigger Type">{data.trigger_type}</Row>
                <Row label="Status">
                  <Badge variant={statusVariant(data.status)}>
                    {data.status}
                  </Badge>
                </Row>
                <Row label="Coverage Window (Asia/Shanghai)">
                  {formatShanghai(data.coverage_window_start)} ~{' '}
                  {formatShanghai(data.coverage_window_end)}
                </Row>
                <Row label="Week Label">{data.week_label}</Row>
                <Row label="Duration">
                  {data.duration_ms != null
                    ? `${Math.round(data.duration_ms / 1000)}s`
                    : '-'}
                </Row>
                <Row label="Draft">
                  {data.draft_report_id ? (
                    <a
                      href={`/admin/reports/${data.draft_report_id}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-info hover:underline"
                    >
                      Open draft in new tab
                      <ExternalLink
                        className="h-3 w-3"
                        strokeWidth={1.75}
                      />
                    </a>
                  ) : (
                    '-'
                  )}
                </Row>
                <Row label="Failure Reason">
                  {data.failure_reason ? (
                    <span className="whitespace-pre-wrap">
                      {data.failure_reason}
                    </span>
                  ) : (
                    '-'
                  )}
                </Row>

                <ExpandableSection
                  title="Gemini Output"
                  value={data.gemini_output}
                />
                <ExpandableSection
                  title="Kimi Output"
                  value={data.kimi_output}
                />
                <ExpandableSection
                  title="Synthesizer Output"
                  value={data.synthesizer_output}
                />

                {(() => {
                  const isStandard =
                    data.status === 'failed' || data.status === 'partial';
                  return (
                    <div className="pt-6">
                      <Button onClick={() => onRetry(data.id, !isStandard)}>
                        {isStandard ? 'Retry this run' : 'Force retry this run'}
                      </Button>
                      {!isStandard && (
                        <p className="mt-2 text-xs text-foreground-muted">
                          This run is in <code>{data.status}</code> state. Force
                          retry marks any stuck rows for this window as failed,
                          then enqueues a fresh run.
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
