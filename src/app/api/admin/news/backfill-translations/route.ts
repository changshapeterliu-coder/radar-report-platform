import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { inngest } from '@/lib/inngest/client';

/**
 * POST /api/admin/news/backfill-translations
 *
 * Admin-only. Scans `news` for rows whose `content_translated` is
 * null/empty and fans out a `news/translate` Inngest event for each.
 *
 * Why this endpoint exists:
 *   1. The publish route's AI Insight news block was creating news rows
 *      WITHOUT enqueuing a translate event (bug fix lands in the same
 *      commit as this endpoint). Every AI Insight row written before the
 *      fix is sitting with `content_translated` = null and renders as
 *      Chinese-original on en mode.
 *   2. Any other news row that didn't get translated for transient
 *      reasons (e.g. an Inngest outage during the post-create fan-out)
 *      can also be backfilled with the same call.
 *
 * Optional query params:
 *   - `?domain_id=<uuid>` — scope to one domain.
 *   - `?source_channel=<str>` — scope to one channel (e.g. 'AI Insight').
 *
 * Returns: { queued, failedToEnqueue, failures }
 */
export async function POST(request: NextRequest) {
  // ── Auth ──
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

  const url = new URL(request.url);
  const domainId = url.searchParams.get('domain_id');
  const sourceChannel = url.searchParams.get('source_channel');

  // ── Scan untranslated news via service role ──
  const service = createServiceRoleClient();
  let query = service
    .from('news')
    .select('id, source_channel, domain_id')
    .or('content_translated.is.null,content_translated.eq.');

  if (domainId) query = query.eq('domain_id', domainId);
  if (sourceChannel) query = query.eq('source_channel', sourceChannel);

  const { data: rows, error: scanErr } = await query;
  if (scanErr) {
    return NextResponse.json(
      {
        code: 'SCAN_ERROR',
        message: `Failed to scan news: ${scanErr.message}`,
        statusCode: 500,
      },
      { status: 500 }
    );
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json(
      { data: { queued: 0, failedToEnqueue: 0, failures: [] } },
      { status: 200 }
    );
  }

  // ── Fan out one event per news row ──
  let queued = 0;
  let failedToEnqueue = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (const row of rows) {
    try {
      await inngest.send({
        name: 'news/translate',
        data: { newsId: row.id },
      });
      queued++;
    } catch (e) {
      failedToEnqueue++;
      failures.push({
        id: row.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json(
    {
      data: {
        queued,
        failedToEnqueue,
        failures: failures.slice(0, 10),
      },
    },
    { status: 202 }
  );
}
