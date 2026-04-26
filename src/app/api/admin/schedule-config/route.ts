import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdmin } from '../_utils/verify-admin';

/**
 * GET  /api/admin/schedule-config?domain_id=<uuid>
 * POST /api/admin/schedule-config
 *
 * Admin-only. Reads / upserts the single schedule_configs row for a domain.
 * V1 assumption: exactly one row per domain (Account Health).
 */

const VALID_CADENCES = ['weekly', 'biweekly'] as const;
const VALID_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
const TIME_OF_DAY_REGEX = /^(0\d|1\d|2[0-3]):[0-5]\d$/;

type Cadence = (typeof VALID_CADENCES)[number];
type DayOfWeek = (typeof VALID_DAYS)[number];

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const admin = await verifyAdmin(supabase);
  if (!admin) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 },
      { status: 403 }
    );
  }

  const domainId = request.nextUrl.searchParams.get('domain_id');
  if (!domainId) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'domain_id query param is required', statusCode: 400 },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from('schedule_configs')
    .select('*')
    .eq('domain_id', domainId)
    .limit(1);

  if (error) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: error.message, statusCode: 500 },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: data?.[0] ?? null });
}

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

  const { domain_id, enabled, cadence, day_of_week, time_of_day } = body as {
    domain_id?: string;
    enabled?: boolean;
    cadence?: string;
    day_of_week?: string;
    time_of_day?: string;
  };

  if (!domain_id || typeof domain_id !== 'string') {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'domain_id is required', statusCode: 400 },
      { status: 400 }
    );
  }
  if (typeof enabled !== 'boolean') {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'enabled (boolean) is required', statusCode: 400 },
      { status: 400 }
    );
  }
  if (!cadence || !VALID_CADENCES.includes(cadence as Cadence)) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: `cadence must be one of: ${VALID_CADENCES.join(', ')}`,
        statusCode: 400,
      },
      { status: 400 }
    );
  }
  if (!day_of_week || !VALID_DAYS.includes(day_of_week as DayOfWeek)) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: `day_of_week must be one of: ${VALID_DAYS.join(', ')}`,
        statusCode: 400,
      },
      { status: 400 }
    );
  }
  if (!time_of_day || !TIME_OF_DAY_REGEX.test(time_of_day)) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: 'time_of_day must match HH:MM (00:00–23:59)',
        statusCode: 400,
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from('schedule_configs')
    .upsert(
      {
        domain_id,
        enabled,
        cadence: cadence as Cadence,
        day_of_week: day_of_week as DayOfWeek,
        time_of_day,
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
