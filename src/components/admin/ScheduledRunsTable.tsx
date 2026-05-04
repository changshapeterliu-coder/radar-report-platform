'use client';

import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface ScheduledRunListRow {
  id: string;
  domain_id: string;
  trigger_type: 'scheduled' | 'manual';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'partial';
  coverage_window_start: string;
  coverage_window_end: string;
  week_label: string;
  draft_report_id: string | null;
  failure_reason: string | null;
  duration_ms: number | null;
  triggered_at: string;
  completed_at: string | null;
}

export interface ScheduledRunsTableProps {
  rows: ScheduledRunListRow[];
  page: number;
  totalCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onOpenDrawer: (runId: string) => void;
  onRetry: (runId: string) => void;
}

function formatTriggeredAt(iso: string): string {
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
  status: ScheduledRunListRow['status']
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

function truncate(s: string, max = 50): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '...';
}

export function ScheduledRunsTable({
  rows,
  page,
  totalCount,
  pageSize,
  onPageChange,
  onOpenDrawer,
  onRetry,
}: ScheduledRunsTableProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
        <p className="text-sm text-foreground-muted">
          No scheduled runs yet. Use &apos;Trigger Now&apos; to start one.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {[
                'Run ID',
                'Triggered At',
                'Trigger',
                'Status',
                'Dur (s)',
                'Draft',
                'Failure Reason',
                'Actions',
              ].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const shortId = row.id.slice(0, 8);
              const durationSec =
                row.duration_ms != null
                  ? Math.round(row.duration_ms / 1000)
                  : null;
              const canRetry =
                row.status === 'failed' || row.status === 'partial';
              return (
                <tr
                  key={row.id}
                  className="border-b border-border last:border-b-0 hover:bg-muted/40"
                >
                  <td className="px-3 py-3 text-sm">
                    <button
                      type="button"
                      onClick={() => onOpenDrawer(row.id)}
                      className="font-mono text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
                    >
                      {shortId}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-sm text-foreground-muted">
                    {formatTriggeredAt(row.triggered_at)}
                  </td>
                  <td className="px-3 py-3 text-sm text-foreground-muted">
                    {row.trigger_type}
                  </td>
                  <td className="px-3 py-3 text-sm">
                    <Badge variant={statusVariant(row.status)}>
                      {row.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 font-mono text-sm text-foreground-muted">
                    {durationSec ?? '-'}
                  </td>
                  <td className="px-3 py-3 text-sm">
                    {row.draft_report_id ? (
                      <a
                        href={`/admin/reports/${row.draft_report_id}/edit`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-info hover:underline"
                      >
                        Draft
                        <ExternalLink
                          className="h-3 w-3"
                          strokeWidth={1.75}
                        />
                      </a>
                    ) : (
                      <span className="text-foreground-subtle">-</span>
                    )}
                  </td>
                  <td
                    className="max-w-[260px] px-3 py-3 text-sm text-foreground-muted"
                    title={row.failure_reason ?? ''}
                  >
                    {row.failure_reason ? truncate(row.failure_reason) : '-'}
                  </td>
                  <td className="px-3 py-3 text-sm">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenDrawer(row.id)}
                      >
                        View
                      </Button>
                      {canRetry && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onRetry(row.id)}
                        >
                          Retry
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <nav
        aria-label="Pagination"
        className="mt-4 flex items-center justify-center gap-3"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
        </Button>
        <span className="text-sm text-foreground-muted">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
        </Button>
      </nav>
    </div>
  );
}
