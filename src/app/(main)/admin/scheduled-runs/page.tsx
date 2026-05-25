'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react';
import { AdminGuard } from '@/components/AdminGuard';
import {
  ScheduledRunsTable,
  type ScheduledRunListRow,
} from '@/components/admin/ScheduledRunsTable';
import { ScheduledRunDrawer } from '@/components/admin/ScheduledRunDrawer';
import { SpinnerBlock } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

interface Toast {
  kind: 'success' | 'error';
  text: string;
}

const PAGE_SIZE = 20;

export default function ScheduledRunsPage() {
  const [rows, setRows] = useState<ScheduledRunListRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerRunId, setDrawerRunId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const fetchRows = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/scheduled-runs?page=${p}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Failed to load runs (${res.status})`);
      const json = await res.json();
      const d = json?.data ?? {};
      setRows((d.rows ?? []) as ScheduledRunListRow[]);
      setTotalCount(Number(d.totalCount ?? 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRows(page);
  }, [page, fetchRows]);

  useEffect(() => {
    if (!toast) return;
    const tmr = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(tmr);
  }, [toast]);

  const handleRetry = useCallback(
    async (runId: string, force = false) => {
      // Force retry is destructive (will produce a duplicate draft if the
      // run was actually still progressing). Confirm before going through.
      if (force) {
        const ok = window.confirm(
          'Force retry will mark any stuck rows for this window as failed and start a fresh run. ' +
            'If the run is genuinely still in progress, this will produce a duplicate draft. Continue?'
        );
        if (!ok) return;
      }
      try {
        const url = `/api/admin/scheduled-runs/${encodeURIComponent(runId)}/retry${force ? '?force=1' : ''}`;
        const res = await fetch(url, { method: 'POST' });
        if (res.status === 202) {
          setToast({
            kind: 'success',
            text: force ? 'Force retry queued.' : 'Retry queued.',
          });
          setDrawerRunId(null);
          void fetchRows(page);
          return;
        }
        if (res.status === 409) {
          setToast({
            kind: 'error',
            text:
              'A run is already in progress for this window. If it is stuck, use Force retry.',
          });
          return;
        }
        if (res.status === 400) {
          const body = await res.json().catch(() => ({}));
          setToast({
            kind: 'error',
            text: body?.message || 'Cannot retry this run',
          });
          return;
        }
        const body = await res.json().catch(() => ({}));
        setToast({
          kind: 'error',
          text: body?.message || `Retry failed (${res.status})`,
        });
      } catch {
        setToast({ kind: 'error', text: 'Network error' });
      }
    },
    [fetchRows, page]
  );

  return (
    <AdminGuard>
      <div className="mx-auto max-w-[1200px]">
        <Link
          href="/admin"
          className="mb-4 inline-flex items-center gap-1 text-sm text-info hover:underline"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          Back to Admin
        </Link>
        <h1 className="mb-8 text-2xl font-semibold text-foreground">
          Scheduled Runs
        </h1>

        {loading && rows.length === 0 ? (
          <SpinnerBlock label="Loading runs" />
        ) : error ? (
          <p className="rounded-md border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger-fg">
            {error}
          </p>
        ) : (
          <ScheduledRunsTable
            rows={rows}
            page={page}
            totalCount={totalCount}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            onOpenDrawer={setDrawerRunId}
            onRetry={handleRetry}
          />
        )}

        <ScheduledRunDrawer
          runId={drawerRunId}
          onClose={() => setDrawerRunId(null)}
          onRetry={handleRetry}
        />

        {toast && (
          <div className="fixed bottom-6 right-6 z-50">
            <div
              role="status"
              className={cn(
                'flex items-start gap-2 rounded-md border px-4 py-3 text-sm shadow-md',
                toast.kind === 'success'
                  ? 'border-success/20 bg-success-bg text-success-fg'
                  : 'border-danger/20 bg-danger-bg text-danger-fg'
              )}
            >
              {toast.kind === 'success' ? (
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 flex-shrink-0"
                  strokeWidth={1.75}
                  aria-hidden
                />
              ) : (
                <AlertCircle
                  className="mt-0.5 h-4 w-4 flex-shrink-0"
                  strokeWidth={1.75}
                  aria-hidden
                />
              )}
              <span>{toast.text}</span>
            </div>
          </div>
        )}
      </div>
    </AdminGuard>
  );
}
