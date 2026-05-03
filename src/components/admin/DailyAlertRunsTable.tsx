'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Toast, type ToastState } from '@/components/ui/Toast';
import { ViewRawOutputModal, type RawOutputRow } from './ViewRawOutputModal';

export interface DailyAlertRunListRow {
  id: string;
  domain_id: string;
  trigger_type: 'scheduled' | 'manual';
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  coverage_window_start_date: string;
  coverage_window_start: string;
  coverage_window_end: string;
  produced_alert_id: string | null;
  topic_count: number | null;
  new_canonical_count: number | null;
  failure_reason: string | null;
  triggered_at: string;
  completed_at: string | null;
}

interface PageResponse {
  rows: DailyAlertRunListRow[];
  page: number;
  page_size: number;
  total_count: number;
}

const PAGE_SIZE = 20;

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

function statusClass(status: DailyAlertRunListRow['status']): string {
  switch (status) {
    case 'succeeded':
      return 'text-green-600';
    case 'failed':
      return 'text-red-600';
    case 'queued':
    case 'running':
      return 'text-blue-600';
    default:
      return 'text-gray-600';
  }
}

function truncate(s: string, max = 80): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/**
 * Paginated list of daily_alert_runs. Columns:
 *   Run ID (short 8 chars, clickable → ViewRawOutputModal)
 *   Triggered At (Shanghai)  · Trigger · Status
 *   Coverage Date · Topics · New · Alert Link (for succeeded)
 *   Failure Reason · Actions (Retry for failed)
 *
 * On small screens, horizontal scroll is enabled. The Retry flow uses a
 * ConfirmModal showing the coverage date.
 */
export function DailyAlertRunsTable() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<DailyAlertRunListRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [rawModalRow, setRawModalRow] = useState<RawOutputRow | null>(null);
  const [retryRow, setRetryRow] = useState<DailyAlertRunListRow | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);

  const fetchRows = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/daily-alert-runs?page=${p}&page_size=${PAGE_SIZE}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: PageResponse };
      setRows(body.data.rows);
      setTotalCount(body.data.total_count);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRows(page);
  }, [page, fetchRows]);

  const handleRetry = async () => {
    if (!retryRow) return;
    setRetryBusy(true);
    try {
      const res = await fetch(
        `/api/admin/daily-alert-runs/${encodeURIComponent(retryRow.id)}/retry`,
        { method: 'POST' }
      );
      if (res.status === 202) {
        setRetryRow(null);
        setToast({ kind: 'success', text: t('adminDailyAlert.runs.retry.successToast') });
        void fetchRows(page);
        return;
      }
      if (res.status === 409) {
        setRetryRow(null);
        setToast({ kind: 'error', text: t('alerts.trigger.alreadyInProgressToast') });
        return;
      }
      if (res.status === 400) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setRetryRow(null);
        setToast({
          kind: 'error',
          text: body.message || t('adminDailyAlert.runs.retry.errorToast'),
        });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setRetryRow(null);
      setToast({
        kind: 'error',
        text: body.message || t('adminDailyAlert.runs.retry.errorToast'),
      });
    } catch {
      setRetryRow(null);
      setToast({ kind: 'error', text: t('adminDailyAlert.runs.retry.errorToast') });
    } finally {
      setRetryBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  if (loading && rows.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-[#ff9900] border-r-transparent" />
        <p className="mt-3 text-sm text-gray-500">{t('common.loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <p className="text-sm text-gray-500">{t('adminDailyAlert.runs.empty')}</p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full border-collapse min-w-[900px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-3 text-left text-xs font-semibold text-[#232f3e] uppercase tracking-wide">
                {t('adminDailyAlert.runs.headers.runId')}
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-[#232f3e] uppercase tracking-wide">
                {t('adminDailyAlert.runs.headers.triggeredAt')}
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-[#232f3e] uppercase tracking-wide">
                {t('adminDailyAlert.runs.headers.triggerType')}
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-[#232f3e] uppercase tracking-wide">
                {t('adminDailyAlert.runs.headers.status')}
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-[#232f3e] uppercase tracking-wide">
                {t('adminDailyAlert.runs.headers.coverageDate')}
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-[#232f3e] uppercase tracking-wide">
                {t('adminDailyAlert.runs.headers.topicCount')}
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-[#232f3e] uppercase tracking-wide">
                {t('adminDailyAlert.runs.headers.newCanonicalCount')}
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-[#232f3e] uppercase tracking-wide">
                {t('adminDailyAlert.runs.headers.alertLink')}
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-[#232f3e] uppercase tracking-wide">
                {t('adminDailyAlert.runs.headers.failureReason')}
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-[#232f3e] uppercase tracking-wide">
                {t('adminDailyAlert.runs.headers.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const shortId = row.id.slice(0, 8);
              const canRetry = row.status === 'failed';
              return (
                <tr key={row.id} className="border-b border-gray-100 last:border-b-0">
                  <td className="px-3 py-3 text-sm">
                    <button
                      type="button"
                      onClick={() =>
                        setRawModalRow({
                          id: row.id,
                          failure_reason: row.failure_reason,
                          raw_output: null,
                        })
                      }
                      className="font-mono text-[#146eb4] hover:underline"
                    >
                      {shortId}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700 whitespace-nowrap">
                    {formatShanghai(row.triggered_at)}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700">{row.trigger_type}</td>
                  <td className={`px-3 py-3 text-sm font-medium ${statusClass(row.status)}`}>
                    {row.status}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700 font-mono">
                    {row.coverage_window_start_date}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700 font-mono">
                    {row.topic_count ?? '—'}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700 font-mono">
                    {row.new_canonical_count ?? '—'}
                  </td>
                  <td className="px-3 py-3 text-sm">
                    {row.status === 'succeeded' && row.produced_alert_id ? (
                      <Link
                        href={`/alerts?window_end_date=${row.coverage_window_start_date}`}
                        className="text-[#146eb4] hover:underline"
                      >
                        {t('adminDailyAlert.runs.viewAlert')} ↗
                      </Link>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td
                    className="px-3 py-3 text-sm text-gray-700 max-w-[240px]"
                    title={row.failure_reason ?? ''}
                  >
                    {row.failure_reason ? truncate(row.failure_reason) : '—'}
                  </td>
                  <td className="px-3 py-3 text-sm">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setRawModalRow({
                            id: row.id,
                            failure_reason: row.failure_reason,
                            raw_output: null,
                          })
                        }
                        className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-[#232f3e] hover:bg-gray-50"
                      >
                        {t('adminDailyAlert.runs.viewRaw.button')}
                      </button>
                      {canRetry && (
                        <button
                          type="button"
                          onClick={() => setRetryRow(row)}
                          className="rounded border border-[#ff9900] px-2 py-1 text-xs font-medium text-[#ff9900] hover:bg-orange-50"
                        >
                          {t('adminDailyAlert.runs.retry.button')}
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
          onClick={() => setPage((p) => Math.max(1, p - 1))}
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
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-[#232f3e] hover:bg-gray-50 disabled:opacity-40"
        >
          Next →
        </button>
      </div>

      <ConfirmModal
        open={!!retryRow}
        title={t('adminDailyAlert.runs.retry.confirmTitle')}
        body={
          <p>
            {retryRow
              ? t('adminDailyAlert.runs.retry.confirmBody').replace(
                  '{date}',
                  retryRow.coverage_window_start_date
                )
              : ''}
          </p>
        }
        confirmLabel={t('adminDailyAlert.runs.retry.confirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={handleRetry}
        onCancel={() => setRetryRow(null)}
        busy={retryBusy}
      />

      <ViewRawOutputModal row={rawModalRow} onClose={() => setRawModalRow(null)} />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
