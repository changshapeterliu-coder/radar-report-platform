import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdmin } from '../../../_utils/verify-admin';
import { inngest } from '@/lib/inngest/client';
import { buildIdempotencyKey } from '@/lib/inngest/idempotency';

/**
 * POST /api/admin/scheduled-runs/[id]/retry
 * Admin-only. Re-enqueues a failed/partial run for the same coverage window.
 * The original run is preserved as history; the partial unique index on
 * scheduled_runs (WHERE status IN ('queued','running','succeeded')) allows
 * a new row for the same (domain_id, coverage_window_start).
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
    .from('scheduled_runs')
    .select('id, domain_id, status, coverage_window_start, coverage_window_end, week_label')
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
      { code: 'NOT_FOUND', message: 'Scheduled run not found', statusCode: 404 },
      { status: 404 }
    );
  }

  if (original.status !== 'failed' && original.status !== 'partial') {
    return NextResponse.json(
      {
        code: 'INVALID_STATE',
        message: 'Only failed or partial runs can be retried',
        statusCode: 400,
      },
      { status: 400 }
    );
  }

  // Conflict check: another queued/running run for the same (domain, window)?
  const { data: activeRuns, error: activeError } = await supabase
    .from('scheduled_runs')
    .select('id')
    .eq('domain_id', original.domain_id)
    .eq('coverage_window_start', original.coverage_window_start)
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
        message: 'A run is already in progress for this window',
        statusCode: 409,
      },
      { status: 409 }
    );
  }

  // Retry must produce a FRESH Inngest event id — reusing the original
  // idempotency key would hit Inngest's 24h event-level dedup and the event
  // would be silently dropped. DB-layer uniqueness is still guarded by the
  // partial unique index (and the activeRuns check above).
  const retryEventId = `${buildIdempotencyKey(original.domain_id, original.coverage_window_start)}:retry:${Date.now()}`;

  await inngest.send({
    name: 'report/generate.requested',
    id: retryEventId,
    data: {
      domainId: original.domain_id,
      triggerType: 'manual',
      coverageWindowStart: original.coverage_window_start,
      coverageWindowEnd: original.coverage_window_end,
      weekLabel: original.week_label,
    },
  });

  return NextResponse.json(
    { data: { queuedAt: new Date().toISOString() } },
    { status: 202 }
  );
}
