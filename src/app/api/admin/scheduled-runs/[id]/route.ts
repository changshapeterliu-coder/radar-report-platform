import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdmin } from '../../_utils/verify-admin';

/**
 * GET /api/admin/scheduled-runs/[id]
 * Admin-only. Returns the full row including the heavy JSONB engine outputs
 * for the "View Logs" drawer.
 */
export async function GET(
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

  const { data, error } = await supabase
    .from('scheduled_runs')
    .select('*')
    .eq('id', id)
    .limit(1);

  if (error) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: error.message, statusCode: 500 },
      { status: 500 }
    );
  }

  if (!data || data.length === 0) {
    return NextResponse.json(
      { code: 'NOT_FOUND', message: 'Scheduled run not found', statusCode: 404 },
      { status: 404 }
    );
  }

  return NextResponse.json({ data: data[0] });
}
