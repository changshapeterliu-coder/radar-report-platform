import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdmin } from '../_utils/verify-admin';

/**
 * GET /api/admin/daily-alert-runs?page=<n>&page_size=<n>
 *
 * Admin-only paginated listing of daily_alert_runs, ordered by triggered_at DESC.
 * page_size is capped at 20. Excludes heavy columns (raw_output) for list view.
 *
 * Spec: .kiro/specs/daily-hot-topic-alert/ — design §API 路由 §3
 */

const MAX_PAGE_SIZE = 20;
const DEFAULT_PAGE_SIZE = 20;

const LIST_COLUMNS =
  'id, domain_id, trigger_type, status, coverage_window_start_date, coverage_window_start, coverage_window_end, produced_alert_id, topic_count, new_canonical_count, failure_reason, triggered_at, completed_at';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const admin = await verifyAdmin(supabase);
  if (!admin) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 },
      { status: 403 }
    );
  }

  const pageParam = request.nextUrl.searchParams.get('page');
  const pageSizeParam = request.nextUrl.searchParams.get('page_size');

  const pageNum = pageParam ? Number(pageParam) : 1;
  if (!Number.isInteger(pageNum) || pageNum < 1) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'page must be a positive integer', statusCode: 400 },
      { status: 400 }
    );
  }

  let pageSize = pageSizeParam ? Number(pageSizeParam) : DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: 'page_size must be a positive integer',
        statusCode: 400,
      },
      { status: 400 }
    );
  }
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;

  const from = (pageNum - 1) * pageSize;
  const to = pageNum * pageSize - 1;

  const { data, count, error } = await supabase
    .from('daily_alert_runs')
    .select(LIST_COLUMNS, { count: 'exact' })
    .order('triggered_at', { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: error.message, statusCode: 500 },
      { status: 500 }
    );
  }

  return NextResponse.json({
    data: {
      rows: data ?? [],
      page: pageNum,
      page_size: pageSize,
      total_count: count ?? 0,
    },
  });
}
