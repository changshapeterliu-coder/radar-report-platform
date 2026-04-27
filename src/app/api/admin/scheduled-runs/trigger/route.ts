import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdmin } from '../../_utils/verify-admin';
import { inngest } from '@/lib/inngest/client';
import { computeCoverageWindow } from '@/lib/inngest/coverage-window';
import { buildIdempotencyKey } from '@/lib/inngest/idempotency';

/**
 * POST /api/admin/scheduled-runs/trigger
 * Admin-only. Enqueues a manual report generation run.
 * Manual trigger is allowed even when the schedule is disabled (R4.5).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const admin = await verifyAdmin(supabase);
  if (!admin) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: 'INVALID_JSON', message: 'Invalid JSON body', statusCode: 400 },
      { status: 400 }
    );
  }

  const { domain_id } = body as { domain_id?: string };
  if (!domain_id || typeof domain_id !== 'string') {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'domain_id is required', statusCode: 400 },
      { status: 400 }
    );
  }

  // Load schedule_configs to get cadence; default to 'biweekly' if none exists
  // (manual trigger is allowed even without a config per R4.5).
  const { data: configRows, error: configError } = await supabase
    .from('schedule_configs')
    .select('cadence')
    .eq('domain_id', domain_id)
    .limit(1);

  if (configError) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: configError.message, statusCode: 500 },
      { status: 500 }
    );
  }

  const cadence: 'weekly' | 'biweekly' = configRows?.[0]?.cadence ?? 'biweekly';
  const coverageWindow = computeCoverageWindow(new Date(), cadence);

  // Conflict check: any active run for the same (domain, window)?
  const { data: activeRuns, error: activeError } = await supabase
    .from('scheduled_runs')
    .select('id')
    .eq('domain_id', domain_id)
    .eq('coverage_window_start', coverageWindow.startIso)
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

  // Fresh Inngest event id each time — Inngest does event-level dedup in a
  // 24h window, so reusing the deterministic key would silently drop manual
  // re-triggers. DB-layer uniqueness is still guarded by the partial unique
  // index on scheduled_runs and the activeRuns conflict check above.
  const triggerEventId = `${buildIdempotencyKey(domain_id, coverageWindow.startIso)}:manual:${Date.now()}`;

  await inngest.send({
    name: 'report/generate.requested',
    id: triggerEventId,
    data: {
      domainId: domain_id,
      triggerType: 'manual',
      coverageWindowStart: coverageWindow.startIso,
      coverageWindowEnd: coverageWindow.endIso,
      weekLabel: coverageWindow.weekLabel,
    },
  });

  return NextResponse.json(
    {
      data: {
        queuedAt: new Date().toISOString(),
        coverageWindow,
      },
    },
    { status: 202 }
  );
}
