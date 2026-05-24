import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { inngest } from '@/lib/inngest/client';

/**
 * POST /api/admin/translations/sweep
 *
 * Admin-only one-shot endpoint that mirrors the daily `translation-sweeper`
 * Inngest function: scans every nullable bilingual surface
 * (`news.content_translated`, `topic_canonicals.canonical_title_en`,
 * `reports.content_translated`) and fans out a translate event per row
 * that needs work.
 *
 * Use this to clear historical backlog without waiting for the 03:00
 * daily sweeper to fire. Idempotent — translate functions short-circuit
 * if the target field is already populated.
 *
 * Returns the same shape as the Inngest sweeper:
 *   { newsScanned, canonScanned, reportScanned,
 *     newsQueued, canonQueued, reportQueued }
 */
export async function POST(_request: NextRequest) {
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

  const service = createServiceRoleClient();

  // ── 1. News rows missing content_translated ──
  // content_translated is JSONB — only IS NULL is meaningful (the empty
  // JSON cases {} / [] are valid translations and we never produce them).
  const { data: newsRows, error: newsErr } = await service
    .from('news')
    .select('id')
    .is('content_translated', null);
  if (newsErr) {
    return NextResponse.json(
      { code: 'SCAN_ERROR', message: `news scan: ${newsErr.message}`, statusCode: 500 },
      { status: 500 }
    );
  }

  let newsQueued = 0;
  for (const row of newsRows ?? []) {
    try {
      await inngest.send({ name: 'news/translate', data: { newsId: row.id } });
      newsQueued++;
    } catch {
      /* per-row failure already logged inside Inngest send */
    }
  }

  // ── 2. Canonicals missing canonical_title_en ──
  const { data: canonRows, error: canonErr } = await service
    .from('topic_canonicals')
    .select('domain_id, canonical_topic_key')
    .or('canonical_title_en.is.null,canonical_title_en.eq.');
  if (canonErr) {
    return NextResponse.json(
      { code: 'SCAN_ERROR', message: `canonicals scan: ${canonErr.message}`, statusCode: 500 },
      { status: 500 }
    );
  }

  let canonQueued = 0;
  for (const row of canonRows ?? []) {
    try {
      await inngest.send({
        name: 'daily-alert/translate-canonical',
        data: { domainId: row.domain_id, canonicalTopicKey: row.canonical_topic_key },
      });
      canonQueued++;
    } catch {
      /* per-row failure already logged */
    }
  }

  // ── 3. Published reports missing content_translated ──
  const { data: reportRows, error: reportErr } = await service
    .from('reports')
    .select('id')
    .eq('status', 'published')
    .is('content_translated', null);
  if (reportErr) {
    return NextResponse.json(
      { code: 'SCAN_ERROR', message: `reports scan: ${reportErr.message}`, statusCode: 500 },
      { status: 500 }
    );
  }

  let reportQueued = 0;
  for (const row of reportRows ?? []) {
    try {
      await inngest.send({ name: 'report/translate', data: { reportId: row.id } });
      reportQueued++;
    } catch {
      /* per-row failure already logged */
    }
  }

  return NextResponse.json(
    {
      data: {
        newsScanned: newsRows?.length ?? 0,
        canonScanned: canonRows?.length ?? 0,
        reportScanned: reportRows?.length ?? 0,
        newsQueued,
        canonQueued,
        reportQueued,
      },
    },
    { status: 202 }
  );
}
