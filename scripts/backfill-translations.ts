/**
 * One-off backfill: enqueue `report/translate` and `news/translate`
 * events for every published report / every news item whose
 * `content_translated` is still NULL.
 *
 * Idempotent. Safe to run multiple times — Inngest's function
 * idempotency + the `content_translated IS NULL` filter mean each row
 * is processed at most once per run, and already-translated rows are
 * skipped inside the Inngest function.
 *
 * Usage:
 *   npm run backfill:translations
 *
 * Requirements:
 *   - .env.local must have NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   - INNGEST_EVENT_KEY (or INNGEST_DEV env if running against dev server)
 *   - Run AFTER deploying the updated Inngest functions to Production +
 *     AFTER clicking Resync in Inngest Cloud.
 */

import 'dotenv/config';
import { Inngest } from 'inngest';
import { createClient } from '@supabase/supabase-js';

const inngest = new Inngest({ id: 'radar-report-platform-backfill' });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env'
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Reports ──────────────────────────────────────────────────
  const { data: reportRows, error: rErr } = await supabase
    .from('reports')
    .select('id, title, published_at')
    .eq('status', 'published')
    .is('content_translated', null)
    .order('published_at', { ascending: false });

  if (rErr) {
    console.error('Failed to query reports:', rErr.message);
    process.exit(1);
  }

  console.log(
    `[reports] Found ${reportRows?.length ?? 0} published reports missing translation`
  );
  for (const r of reportRows ?? []) {
    console.log(`  → report ${r.id} (${r.title ?? 'untitled'})`);
    await inngest.send({
      name: 'report/translate',
      data: { reportId: r.id },
    });
  }

  // ── News ─────────────────────────────────────────────────────
  const { data: newsRows, error: nErr } = await supabase
    .from('news')
    .select('id, title, published_at')
    .is('content_translated', null)
    .order('published_at', { ascending: false });

  if (nErr) {
    console.error('Failed to query news:', nErr.message);
    process.exit(1);
  }

  console.log(
    `[news] Found ${newsRows?.length ?? 0} news items missing translation`
  );
  for (const n of newsRows ?? []) {
    console.log(`  → news ${n.id} (${n.title})`);
    await inngest.send({
      name: 'news/translate',
      data: { newsId: n.id },
    });
  }

  const total = (reportRows?.length ?? 0) + (newsRows?.length ?? 0);
  console.log(`\nEnqueued ${total} translation events.`);
  console.log(
    'Check Inngest dashboard → Functions → report-translate / news-translate for progress.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
