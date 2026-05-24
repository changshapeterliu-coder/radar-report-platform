import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { inngest } from '@/lib/inngest/client';

/**
 * POST /api/admin/canonicals/backfill-translations
 *
 * Admin-only. Scans `topic_canonicals` for rows whose `canonical_title_en`
 * is NULL/empty and fans out a `daily-alert/translate-canonical` Inngest
 * event for each one. The translate function (idempotent) reads the row,
 * calls OpenRouter, and writes `canonical_title_en` /
 * `canonical_description_en` back.
 *
 * Why this endpoint exists:
 *   The W17/W19 backfill script ran locally. `.env.local` does not carry
 *   `INNGEST_EVENT_KEY`, so the per-key translate fan-out from the
 *   backfill was rejected on `inngest.send`. The newly minted canonicals
 *   were persisted with `_en` NULL, and the dashboard now shows them as
 *   `(Chinese original)` on en mode. Re-running the backfill from
 *   production would re-canonicalize the reports unnecessarily; this
 *   endpoint just enqueues the missing translate events.
 *
 * Optional `?domain_id=<uuid>` query param scopes the backfill to one
 * domain. Without it, it scans every domain.
 *
 * Returns: { queued: <int>, alreadyTranslated: <int>, failedToEnqueue: <int> }
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

  // ── Scan untranslated canonicals via service role ──
  const service = createServiceRoleClient();
  let query = service
    .from('topic_canonicals')
    .select('domain_id, canonical_topic_key, canonical_title_zh, canonical_title_en')
    .or('canonical_title_en.is.null,canonical_title_en.eq.');

  if (domainId) {
    query = query.eq('domain_id', domainId);
  }

  const { data: rows, error: scanErr } = await query;
  if (scanErr) {
    return NextResponse.json(
      {
        code: 'SCAN_ERROR',
        message: `Failed to scan topic_canonicals: ${scanErr.message}`,
        statusCode: 500,
      },
      { status: 500 }
    );
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json(
      { data: { queued: 0, alreadyTranslated: 0, failedToEnqueue: 0 } },
      { status: 200 }
    );
  }

  // ── Fan out one event per canonical, per-event try/catch ──
  let queued = 0;
  let failedToEnqueue = 0;
  const failures: Array<{ key: string; error: string }> = [];

  for (const row of rows) {
    try {
      await inngest.send({
        name: 'daily-alert/translate-canonical',
        data: {
          domainId: row.domain_id,
          canonicalTopicKey: row.canonical_topic_key,
        },
      });
      queued++;
    } catch (e) {
      failedToEnqueue++;
      failures.push({
        key: row.canonical_topic_key,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json(
    {
      data: {
        queued,
        alreadyTranslated: 0,
        failedToEnqueue,
        failures: failures.slice(0, 10), // cap for response size
      },
    },
    { status: 202 }
  );
}
