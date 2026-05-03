import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdmin } from '../../../_utils/verify-admin';
import { inngest } from '@/lib/inngest/client';

/**
 * POST /api/admin/daily-alert-runs/[id]/retry
 *
 * Admin-only. Re-enqueues a FAILED daily_alert_run for the same coverage date.
 * Unlike scheduled_runs, daily_alert_runs has no 'partial' status — only 'failed'
 * is retryable.
 *
 * The original failed run is preserved as history; the partial unique index on
 * daily_alert_runs (WHERE status IN ('queued','running','succeeded')) allows a
 * new row for the same (domain_id, coverage_window_start_date).
 *
 * Spec: .kiro/specs/daily-hot-topic-alert/ — design §API 路由 §4
 */

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const supabase = await createClient();
  const admin = await verifyAdmin(supabase);
  if (!admin) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 },
      { status: 403 }
    );
  }

  const { data: originalRows, error: fetchError } = await supabase
    .from('daily_alert_runs')
    .select(
      'id, domain_id, status, coverage_window_start_date, coverage_window_start, coverage_window_end'
    )
    .eq('id', id)
    .limit(1);

  if (fetchError) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: fetchError.message, statusCode: 500 },
      { status: 500 }
    );
  }

  const original = originalRows?.[0];
  if (!original) {
    return NextResponse.json(
      { code: 'NOT_FOUND', message: 'Daily alert run not found', statusCode: 404 },
      { status: 404 }
    );
  }

  if (original.status !== 'failed') {
    return NextResponse.json(
      {
        code: 'INVALID_STATE',
        message: 'Only failed runs can be retried',
        statusCode: 400,
      },
      { status: 400 }
    );
  }

  // Conflict check: any queued/running run for the same (domain, coverage date)?
  const { data: activeRuns, error: activeError } = await supabase
    .from('daily_alert_runs')
    .select('id')
    .eq('domain_id', original.domain_id)
    .eq('coverage_window_start_date', original.coverage_window_start_date)
    .in('status', ['queued', 'running'])
    .limit(1);

  if (activeError) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: activeError.message, statusCode: 500 },
      { status: 500 }
    );
  }

  if (activeRuns && activeRuns.length > 0) {
    return NextResponse.json(
      {
        code: 'RUN_IN_PROGRESS',
        message: 'A daily alert run is already in progress for this coverage date',
        statusCode: 409,
      },
      { status: 409 }
    );
  }

  // Fresh Inngest event id — retries must produce a unique id to bypass
  // Inngest's 24h event-level dedup.
  const retryEventId = `daily-alert:${original.domain_id}:${original.coverage_window_start_date}:retry:${Date.now()}`;

  await inngest.send({
    name: 'daily-alert/manual-trigger',
    id: retryEventId,
    data: {
      domainId: original.domain_id,
      triggerType: 'manual',
      coverageWindowStartDate: original.coverage_window_start_date,
      coverageWindowStartIso: original.coverage_window_start,
      coverageWindowEndIso: original.coverage_window_end,
    },
  });

  return NextResponse.json(
    { data: { queuedAt: new Date().toISOString() } },
    { status: 202 }
  );
}
