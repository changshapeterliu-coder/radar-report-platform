'use client';

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

function statusClass(status: ScheduledRunListRow['status']): string {
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

function truncate(s: string, max = 50): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
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
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <p className="text-sm text-gray-500">
          No scheduled runs yet. Use &apos;Trigger Now&apos; to start one.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#232f3e]">Run ID</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#232f3e]">Triggered At</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#232f3e]">Trigger</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#232f3e]">Status</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#232f3e]">Dur (s)</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#232f3e]">Draft</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#232f3e]">Failure Reason</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[#232f3e]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const shortId = row.id.slice(0, 8);
              const durationSec =
                row.duration_ms != null ? Math.round(row.duration_ms / 1000) : null;
              const canRetry = row.status === 'failed' || row.status === 'partial';
              return (
                <tr key={row.id} className="border-b border-gray-200 last:border-b-0">
                  <td className="px-4 py-3 text-sm">
                    <button
                      type="button"
                      onClick={() => onOpenDrawer(row.id)}
                      className="font-mono text-[#146eb4] hover:underline"
                    >
                      {shortId}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {formatTriggeredAt(row.triggered_at)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{row.trigger_type}</td>
                  <td className={`px-4 py-3 text-sm font-medium ${statusClass(row.status)}`}>
                    {row.status}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {durationSec ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {row.draft_report_id ? (
                      <a
                        href={`/admin/reports/${row.draft_report_id}/edit`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#146eb4] hover:underline"
                      >
                        Draft ↗
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td
                    className="px-4 py-3 text-sm text-gray-700 max-w-[260px]"
                    title={row.failure_reason ?? ''}
                  >
                    {row.failure_reason ? truncate(row.failure_reason) : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenDrawer(row.id)}
                        className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-[#232f3e] hover:bg-gray-50"
                      >
                        View Logs
                      </button>
                      {canRetry && (
                        <button
                          type="button"
                          onClick={() => onRetry(row.id)}
                          className="rounded border border-[#ff9900] px-2 py-1 text-xs font-medium text-[#ff9900] hover:bg-orange-50"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-[#232f3e] hover:bg-gray-50 disabled:opacity-40"
        >
          ← Prev
        </button>
        <span className="text-sm text-gray-600">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-[#232f3e] hover:bg-gray-50 disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
