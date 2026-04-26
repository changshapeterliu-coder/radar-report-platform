'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdminGuard } from '@/components/AdminGuard';
import {
  ScheduledRunsTable,
  type ScheduledRunListRow,
} from '@/components/admin/ScheduledRunsTable';
import { ScheduledRunDrawer } from '@/components/admin/ScheduledRunDrawer';

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
      const res = await fetch(`/api/admin/scheduled-runs?page=${p}`, { cache: 'no-store' });
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
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const handleRetry = useCallback(
    async (runId: string) => {
      try {
        const res = await fetch(
          `/api/admin/scheduled-runs/${encodeURIComponent(runId)}/retry`,
          { method: 'POST' }
        );
        if (res.status === 202) {
          setToast({ kind: 'success', text: 'Retry queued.' });
          setDrawerRunId(null);
          void fetchRows(page);
          return;
        }
        if (res.status === 409) {
          setToast({
            kind: 'error',
            text: 'A run is already in progress for this window',
          });
          return;
        }
        if (res.status === 400) {
          const body = await res.json().catch(() => ({}));
          setToast({
            kind: 'error',
            text: body?.message || 'Only failed or partial runs can be retried',
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
      <div className="max-w-[1200px] mx-auto px-4 py-10">
        <Link href="/admin" className="mb-4 inline-block text-sm text-[#146eb4] hover:underline">
          ← Back to Admin
        </Link>
        <h1 className="text-2xl font-bold text-[#232f3e] mb-6">Scheduled Runs</h1>

        {loading && rows.length === 0 ? (
          <p className="text-sm text-gray-500">Loading runs...</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
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
              className={`rounded border px-4 py-3 text-sm shadow-md ${
                toast.kind === 'success'
                  ? 'border-green-300 bg-green-50 text-green-700'
                  : 'border-red-300 bg-red-50 text-red-700'
              }`}
            >
              {toast.text}
            </div>
          </div>
        )}
      </div>
    </AdminGuard>
  );
}
