/**
 * One-off backfill: for every published `regular` report whose
 * topic_rankings rows are missing, run the same LLM-stabilized
 * extraction the publish API runs and insert into topic_rankings.
 *
 * Why this exists:
 *   The publish API has always done this on every publish, but the
 *   extraction block was wrapped in a fully-silent try/catch and a
 *   bunch of older reports went out before it ran reliably (no env,
 *   no logs, no rows). Result: Dashboard trend chart had nothing to
 *   render even with 2+ weeks of reports.
 *
 *   The publish route is now fixed (logs failures, uses shared
 *   helper). This script repairs history.
 *
 * Idempotent. A report is processed only if it has zero rows in
 * topic_rankings. Re-runs against an already-populated DB are no-ops.
 *
 * Usage:
 *   npm run backfill:topic-rankings
 *   npm run backfill:topic-rankings -- --domain=<uuid>   # single domain
 *   npm run backfill:topic-rankings -- --report=<uuid>   # single report
 *
 * Requirements (in .env.local):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY    (bypasses RLS)
 *   - OPENROUTER_API_KEY           (for label stabilization)
 */

import { createClient } from '@supabase/supabase-js';
import { extractAndPersistTopicRankings } from '../src/lib/topic-rankings/persist';
import type { ReportContent } from '../src/types/report';

interface Args {
  domain?: string;
  report?: string;
}

function parseArgs(): Args {
  const out: Args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (!m) continue;
    if (m[1] === 'domain') out.domain = m[2];
    if (m[1] === 'report') out.report = m[2];
  }
  return out;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (!apiKey) {
    console.error('Missing OPENROUTER_API_KEY — needed for topic label stabilization');
    process.exit(1);
  }

  const args = parseArgs();
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Find candidate reports.
  let q = supabase
    .from('reports')
    .select('id, domain_id, week_label, title, content, published_at')
    .eq('status', 'published')
    .eq('type', 'regular')
    .order('published_at', { ascending: true });

  if (args.domain) q = q.eq('domain_id', args.domain);
  if (args.report) q = q.eq('id', args.report);

  const { data: reports, error: rErr } = await q;
  if (rErr) {
    console.error('Failed to query reports:', rErr.message);
    process.exit(1);
  }

  if (!reports || reports.length === 0) {
    console.log('No published regular reports matched. Nothing to do.');
    return;
  }

  console.log(`Found ${reports.length} candidate published regular report(s).`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let totalInserted = 0;

  for (const r of reports) {
    // Skip reports that already have rows.
    const { count, error: cErr } = await supabase
      .from('topic_rankings')
      .select('id', { count: 'exact', head: true })
      .eq('report_id', r.id);

    if (cErr) {
      console.error(`  ✗ ${r.id} (${r.week_label ?? 'no-week'}) — count check failed: ${cErr.message}`);
      failed++;
      continue;
    }

    if ((count ?? 0) > 0) {
      console.log(`  ↷ ${r.id} (${r.week_label ?? 'no-week'}) — already has ${count} rankings, skipping`);
      skipped++;
      continue;
    }

    const content = r.content as ReportContent | null;
    if (!content?.modules?.length) {
      console.log(`  ↷ ${r.id} (${r.week_label ?? 'no-week'}) — no modules, skipping`);
      skipped++;
      continue;
    }

    try {
      console.log(`  → ${r.id} (${r.week_label ?? 'no-week'}) "${r.title}"`);
      const result = await extractAndPersistTopicRankings({
        supabase,
        reportId: r.id,
        domainId: r.domain_id,
        weekLabel: r.week_label,
        content,
        apiKey,
      });
      console.log(
        `    inserted=${result.inserted} perModule=${JSON.stringify(result.perModule)} newLabels=${result.newLabels.length}`
      );
      processed++;
      totalInserted += result.inserted;
    } catch (e) {
      console.error(`    ✗ failed: ${(e as Error).message}`);
      failed++;
    }
  }

  console.log('');
  console.log(
    `Done. processed=${processed} skipped=${skipped} failed=${failed} totalRowsInserted=${totalInserted}`
  );
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
