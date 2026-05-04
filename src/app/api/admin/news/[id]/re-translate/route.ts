import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { inngest } from '@/lib/inngest/client';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/news/[id]/re-translate
 *
 * Admin-only. Clears `news.content_translated` then enqueues a
 * `news/translate` event with `force: true`.
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

  const { data: cleared, error: clearErr } = await supabase
    .from('news')
    .update({ content_translated: null })
    .eq('id', id)
    .select('id')
    .single();
  if (clearErr || !cleared) {
    return NextResponse.json(
      { code: 'NOT_FOUND', message: 'News not found', statusCode: 404 },
      { status: 404 }
    );
  }

  try {
    await inngest.send({
      name: 'news/translate',
      data: { newsId: id, force: true },
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
