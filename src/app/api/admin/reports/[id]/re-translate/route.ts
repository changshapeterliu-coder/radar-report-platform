import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { inngest } from '@/lib/inngest/client';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/reports/[id]/re-translate
 *
 * Admin-only. Clears `reports.content_translated` then enqueues a
 * `report/translate` event with `force: true`. The Inngest function
 * picks it up, calls OpenRouter, and writes the new translation back.
 *
 * Returns 202 Accepted — the actual translation happens asynchronously
 * (typically completes in <60s). Client should rely on the toast to
 * confirm queueing; the UI will show the translated content on next
 * page load / SWR revalidation after Inngest writes back.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      { status: 401 }
    );
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (profile?.role !== 'admin') {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 },
      { status: 403 }
    );
  }

  // Clear existing translation so the Inngest function is guaranteed to
  // re-fetch fresh content and produce a new translation.
  const { data: cleared, error: clearErr } = await supabase
    .from('reports')
    .update({ content_translated: null })
    .eq('id', id)
    .select('id')
    .single();
  if (clearErr || !cleared) {
    return NextResponse.json(
      { code: 'NOT_FOUND', message: 'Report not found', statusCode: 404 },
      { status: 404 }
    );
  }

  try {
    await inngest.send({
      name: 'report/translate',
      data: { reportId: id, force: true },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Enqueue failed';
    return NextResponse.json(
      { code: 'ENQUEUE_ERROR', message: msg, statusCode: 500 },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { queued: true } }, { status: 202 });
}
