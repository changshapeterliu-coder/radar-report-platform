import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { verifyAdmin } from '../../../_utils/verify-admin';
import { inngest } from '@/lib/inngest/client';
import { buildIdempotencyKey } from '@/lib/inngest/idempotency';

/**
 * POST /api/admin/scheduled-runs/[id]/retry
 * POST /api/admin/scheduled-runs/[id]/retry?force=1
 *
 * Admin-only. Re-enqueues a run for the same coverage window.
 *
 * Default mode: only failed / partial runs can be retried. The original
 * row is preserved as history.
 *
 * Force mode (?force=1): retries regardless of status. Any stuck
 * queued/running rows for the same (domain, window) get marked as
 * 'failed' first ("manually marked failed via force-retry") so the
 * partial unique index releases its slot. Use this only when a run is
 * genuinely stuck (e.g. an Inngest-side crash leaves the DB row pinned
 * to running but no function instance is actually executing).
 *
 * The partial unique index on scheduled_runs WHERE status IN
 * ('queued','running','succeeded') allows a new row for the same
 * (domain_id, coverage_window_start) once the stuck row is marked failed.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const force = url.searchParams.get('force') === '1';

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

  // Default mode: only retry failed/partial runs. Force mode skips this gate.
  if (!force && original.status !== 'failed' && original.status !== 'partial') {
    return NextResponse.json(
      {
        code: 'INVALID_STATE',
        message:
          'Only failed or partial runs can be retried. Use force=1 to override (will mark stuck running rows as failed first).',
        statusCode: 400,
      },
      { status: 400 }
    );
  }

  // Force mode: clear any stuck queued/running rows for this window so the
  // partial unique index releases its slot before the new run inserts.
  // Service-role client because the UPDATE crosses RLS for non-owner runs.
  if (force) {
    const service = createServiceRoleClient();
    const { error: clearError } = await service
      .from('scheduled_runs')
      .update({
        status: 'failed',
        failure_reason:
          'manually marked failed via force-retry (stuck in queued/running)',
        completed_at: new Date().toISOString(),
      })
      .eq('domain_id', original.domain_id)
      .eq('coverage_window_start', original.coverage_window_start)
      .in('status', ['queued', 'running']);

    if (clearError) {
      return NextResponse.json(
        {
          code: 'CLEAR_STUCK_ERROR',
          message: `Failed to clear stuck runs: ${clearError.message}`,
          statusCode: 500,
        },
        { status: 500 }
      );
    }
  } else {
    // Default mode also keeps the conflict check — fail loudly if a fresh
    // run is genuinely in progress (vs. stuck), so admins don't double-up.
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
          message:
            'A run is already in progress for this window. Use force=1 if you believe it is stuck.',
          statusCode: 409,
        },
        { status: 409 }
      );
    }
  }

  // Retry must produce a FRESH Inngest event id — reusing the original
  // idempotency key would hit Inngest's 24h event-level dedup and the event
  // would be silently dropped. DB-layer uniqueness is still guarded by the
  // partial unique index (and the activeRuns / force-clear path above).
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
    { data: { queuedAt: new Date().toISOString(), forced: force } },
    { status: 202 }
  );
}
