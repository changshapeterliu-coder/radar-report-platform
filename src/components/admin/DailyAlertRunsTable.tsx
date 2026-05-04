'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SpinnerBlock } from '@/components/ui/spinner';
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

function statusVariant(
  status: DailyAlertRunListRow['status']
): 'success' | 'danger' | 'info' | 'default' {
  switch (status) {
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'danger';
    case 'queued':
    case 'running':
      return 'info';
    default:
      return 'default';
  }
}

function truncate(s: string, max = 80): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '...';
}

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
      const res = await fetch(
        `/api/admin/daily-alert-runs?page=${p}&page_size=${PAGE_SIZE}`,
        { cache: 'no-store' }
      );
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
        setToast({
          kind: 'success',
          text: t('adminDailyAlert.runs.retry.successToast'),
        });
        void fetchRows(page);
        return;
      }
      if (res.status === 409) {
        setRetryRow(null);
        setToast({
          kind: 'error',
          text: t('alerts.trigger.alreadyInProgressToast'),
        });
        return;
      }
      if (res.status === 400) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        setRetryRow(null);
        setToast({
          kind: 'error',
          text: body.message || t('adminDailyAlert.runs.retry.errorToast'),
        });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
      };
      setRetryRow(null);
      setToast({
        kind: 'error',
        text: body.message || t('adminDailyAlert.runs.retry.errorToast'),
      });
    } catch {
      setRetryRow(null);
      setToast({
        kind: 'error',
        text: t('adminDailyAlert.runs.retry.errorToast'),
      });
    } finally {
      setRetryBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  if (loading && rows.length === 0) {
    return <SpinnerBlock label={t('common.loading')} />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-danger/20 bg-danger-bg p-6 text-center">
        <p className="text-sm text-danger-fg">{error}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
        <p className="text-sm text-foreground-muted">
          {t('adminDailyAlert.runs.empty')}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {[
                t('adminDailyAlert.runs.headers.runId'),
                t('adminDailyAlert.runs.headers.triggeredAt'),
                t('adminDailyAlert.runs.headers.triggerType'),
                t('adminDailyAlert.runs.headers.status'),
                t('adminDailyAlert.runs.headers.coverageDate'),
                t('adminDailyAlert.runs.headers.topicCount'),
                t('adminDailyAlert.runs.headers.newCanonicalCount'),
                t('adminDailyAlert.runs.headers.alertLink'),
                t('adminDailyAlert.runs.headers.failureReason'),
                t('adminDailyAlert.runs.headers.actions'),
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
              const canRetry = row.status === 'failed';
              return (
                <tr
                  key={row.id}
                  className="border-b border-border last:border-b-0 hover:bg-muted/40"
                >
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
                      className="font-mono text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
                    >
                      {shortId}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-sm text-foreground-muted">
                    {formatShanghai(row.triggered_at)}
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
                    {row.coverage_window_start_date}
                  </td>
                  <td className="px-3 py-3 font-mono text-sm text-foreground-muted">
                    {row.topic_count ?? '-'}
                  </td>
                  <td className="px-3 py-3 font-mono text-sm text-foreground-muted">
                    {row.new_canonical_count ?? '-'}
                  </td>
                  <td className="px-3 py-3 text-sm">
                    {row.status === 'succeeded' && row.produced_alert_id ? (
                      <Link
                        href={`/alerts?window_end_date=${row.coverage_window_start_date}`}
                        className="inline-flex items-center gap-0.5 text-info hover:underline"
                      >
                        {t('adminDailyAlert.runs.viewAlert')}
                        <ExternalLink
                          className="h-3 w-3"
                          strokeWidth={1.75}
                        />
                      </Link>
                    ) : (
                      <span className="text-foreground-subtle">-</span>
                    )}
                  </td>
                  <td
                    className="max-w-[240px] px-3 py-3 text-sm text-foreground-muted"
                    title={row.failure_reason ?? ''}
                  >
                    {row.failure_reason ? truncate(row.failure_reason) : '-'}
                  </td>
                  <td className="px-3 py-3 text-sm">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setRawModalRow({
                            id: row.id,
                            failure_reason: row.failure_reason,
                            raw_output: null,
                          })
                        }
                      >
                        {t('adminDailyAlert.runs.viewRaw.button')}
                      </Button>
                      {canRetry && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRetryRow(row)}
                        >
                          {t('adminDailyAlert.runs.retry.button')}
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
          onClick={() => setPage((p) => Math.max(1, p - 1))}
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
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
        </Button>
      </nav>

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

      <ViewRawOutputModal
        row={rawModalRow}
        onClose={() => setRawModalRow(null)}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
