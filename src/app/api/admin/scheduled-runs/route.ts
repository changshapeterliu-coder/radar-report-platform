import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdmin } from '../_utils/verify-admin';

/**
 * GET /api/admin/scheduled-runs?page=<n>
 * Admin-only paginated list. Excludes heavy JSONB columns (engine outputs)
 * to keep the list payload small — fetch by id for detail view.
 */

const PAGE_SIZE = 20;

const LIST_COLUMNS =
  'id, domain_id, trigger_type, status, coverage_window_start, coverage_window_end, week_label, draft_report_id, failure_reason, duration_ms, triggered_at, completed_at';

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
  const pageNum = pageParam ? Number(pageParam) : 1;
  if (!Number.isInteger(pageNum) || pageNum < 1) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'page must be a positive integer', statusCode: 400 },
      { status: 400 }
    );
  }

  const from = (pageNum - 1) * PAGE_SIZE;
  const to = pageNum * PAGE_SIZE - 1;

  const { data, count, error } = await supabase
    .from('scheduled_runs')
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
      totalCount: count ?? 0,
      page: pageNum,
      pageSize: PAGE_SIZE,
    },
  });
}
