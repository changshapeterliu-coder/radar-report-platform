import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdmin } from '../../_utils/verify-admin';
import { inngest } from '@/lib/inngest/client';
import {
  computeCoverageDate,
  computeCoverageWindowIso,
  toShanghai,
} from '@/lib/daily-alert/coverage-window';

/**
 * POST /api/admin/daily-alert-runs/trigger
 *
 * Admin-only manual trigger for the daily hot-topic alert. Even when
 * daily_alert_configs.enabled = false, a manual trigger is allowed (Req 3.3).
 *
 * V1 is fixed to the Account Health domain (one domain) → no body params.
 * Coverage window = previous Asia/Shanghai calendar day, derived server-side.
 *
 * Spec: .kiro/specs/daily-hot-topic-alert/ — Requirement 3, design §API 路由 §2
 */

const DEFAULT_DOMAIN_NAME = 'Account Health';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const admin = await verifyAdmin(supabase);
  if (!admin) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 },
      { status: 403 }
    );
  }

  // V1: body is {} but still try/catch for forward-compat + malformed JSON.
  try {
    const text = await request.text();
    if (text.length > 0) JSON.parse(text);
  } catch {
    return NextResponse.json(
      { code: 'INVALID_JSON', message: 'Invalid JSON body', statusCode: 400 },
      { status: 400 }
    );
  }

  // Resolve Account Health domain_id by name.
  const { data: domainRows, error: domainError } = await supabase
    .from('domains')
    .select('id')
    .eq('name', DEFAULT_DOMAIN_NAME)
    .limit(1);
  if (domainError) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: domainError.message, statusCode: 500 },
      { status: 500 }
    );
  }
  const domainId = domainRows?.[0]?.id;
  if (!domainId) {
    return NextResponse.json(
      {
        code: 'NOT_FOUND',
        message: `Default domain "${DEFAULT_DOMAIN_NAME}" not found`,
        statusCode: 404,
      },
      { status: 404 }
    );
  }

  const nowShanghai = toShanghai(new Date());
  const coverageWindowStartDate = computeCoverageDate(nowShanghai);
  const { startIso, endIso } = computeCoverageWindowIso(coverageWindowStartDate);

  // Conflict check — any queued/running run for the same (domain, coverage date)?
  const { data: activeRuns, error: activeError } = await supabase
    .from('daily_alert_runs')
    .select('id')
    .eq('domain_id', domainId)
    .eq('coverage_window_start_date', coverageWindowStartDate)
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

  // Fresh Inngest event id — Inngest does 24h event-level dedup, reusing the
  // deterministic key would silently drop manual re-triggers.
  const triggerEventId = `daily-alert:${domainId}:${coverageWindowStartDate}:manual:${Date.now()}`;

  await inngest.send({
    name: 'daily-alert/manual-trigger',
    id: triggerEventId,
    data: {
      domainId,
      triggerType: 'manual',
      coverageWindowStartDate,
      coverageWindowStartIso: startIso,
      coverageWindowEndIso: endIso,
    },
  });

  return NextResponse.json(
    {
      data: {
        queuedAt: new Date().toISOString(),
        coverageWindow: {
          start: startIso,
          end: endIso,
          date: coverageWindowStartDate,
        },
      },
    },
    { status: 202 }
  );
}
