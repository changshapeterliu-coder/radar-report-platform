import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdmin } from '../_utils/verify-admin';

/**
 * GET  /api/admin/daily-alert-configs?domain_id=<uuid>
 * PUT  /api/admin/daily-alert-configs
 *
 * Admin-only. Reads / upserts the single daily_alert_configs row for a domain.
 * V1 assumption: exactly one row per domain (Account Health); domain_id is optional
 * on GET and omitted → resolve Account Health by name.
 *
 * Style mirrors /api/admin/schedule-config (hand-rolled validation, `{code,message,statusCode}`
 * error shape, cookie-based SSR client + RLS).
 *
 * Spec: .kiro/specs/daily-hot-topic-alert/ — Requirement 1.x, design §API 路由 §1
 */

const TIME_OF_DAY_REGEX = /^(0\d|1\d|2[0-3]):[0-5]\d$/;
const PINNED_TIMEZONE = 'Asia/Shanghai';
const DEFAULT_DOMAIN_NAME = 'Account Health';

async function resolveDomainId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  explicitDomainId: string | null | undefined
): Promise<{ ok: true; id: string } | { ok: false; status: number; code: string; message: string }> {
  if (explicitDomainId && typeof explicitDomainId === 'string') {
    return { ok: true, id: explicitDomainId };
  }
  const { data, error } = await supabase
    .from('domains')
    .select('id')
    .eq('name', DEFAULT_DOMAIN_NAME)
    .limit(1);
  if (error) {
    return { ok: false, status: 500, code: 'QUERY_ERROR', message: error.message };
  }
  const id = data?.[0]?.id;
  if (!id) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: `Default domain "${DEFAULT_DOMAIN_NAME}" not found`,
    };
  }
  return { ok: true, id };
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const admin = await verifyAdmin(supabase);
  if (!admin) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 },
      { status: 403 }
    );
  }

  const explicitDomainId = request.nextUrl.searchParams.get('domain_id');
  const resolved = await resolveDomainId(supabase, explicitDomainId);
  if (!resolved.ok) {
    return NextResponse.json(
      { code: resolved.code, message: resolved.message, statusCode: resolved.status },
      { status: resolved.status }
    );
  }

  const { data, error } = await supabase
    .from('daily_alert_configs')
    .select('*')
    .eq('domain_id', resolved.id)
    .limit(1);

  if (error) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: error.message, statusCode: 500 },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: data?.[0] ?? null });
}

export async function PUT(request: NextRequest) {
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

  const { domain_id, enabled, time_of_day, timezone } = body as {
    domain_id?: string;
    enabled?: boolean;
    time_of_day?: string;
    timezone?: string;
  };

  if (typeof enabled !== 'boolean') {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'enabled (boolean) is required', statusCode: 400 },
      { status: 400 }
    );
  }
  if (!time_of_day || typeof time_of_day !== 'string' || !TIME_OF_DAY_REGEX.test(time_of_day)) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: 'time_of_day must match HH:MM (00:00–23:59)',
        statusCode: 400,
      },
      { status: 400 }
    );
  }
  if (timezone !== PINNED_TIMEZONE) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: `timezone must be "${PINNED_TIMEZONE}"`,
        statusCode: 400,
      },
      { status: 400 }
    );
  }

  const resolved = await resolveDomainId(supabase, domain_id);
  if (!resolved.ok) {
    return NextResponse.json(
      { code: resolved.code, message: resolved.message, statusCode: resolved.status },
      { status: resolved.status }
    );
  }

  const { data, error } = await supabase
    .from('daily_alert_configs')
    .upsert(
      {
        domain_id: resolved.id,
        enabled,
        time_of_day,
        timezone: PINNED_TIMEZONE,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'domain_id' }
    )
    .select()
    .limit(1);

  if (error) {
    return NextResponse.json(
      { code: 'UPDATE_ERROR', message: error.message, statusCode: 500 },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: data?.[0] ?? null });
}
