import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

/**
 * Health + keep-alive endpoint.
 *
 * Hit every 4 minutes by Vercel Cron (see vercel.json) to prevent two
 * cold-start sources from combining into a 10s first-load:
 *
 *   1. Vercel serverless function idle eviction (~5 min on Pro, longer but
 *      still real). The cron invocation itself keeps this route warm, and
 *      warms shared module init (i18n, Supabase client factories, etc.)
 *      for neighbouring routes sharing the same deployment bundle.
 *
 *   2. Supabase Postgres connection-pool cold connection. A cheap
 *      `SELECT id FROM domains LIMIT 1` via the service-role client forces
 *      the pooler to open / reuse a live connection, so the first real
 *      user request after a quiet period doesn't eat the TLS + auth cost.
 *
 * Design guarantees:
 *   - No RLS-dependent query (service role bypasses RLS), so an
 *     unauthenticated keep-alive still touches Postgres.
 *   - Never throws — cron is a best-effort warm-up; a 500 would spam the
 *     Vercel cron dashboard. Any error is reported in the JSON body.
 *   - Zero side-effects: no writes, no rate-limited external calls.
 *
 * Cost envelope: 1 query / 4 min = 360 / day ≈ 11k / month. Supabase free
 * tier allows ~500k reads/month, Pro is effectively unlimited.
 *
 * Observability: the response includes `durationMs` so you can eyeball
 * Supabase cold-connection latency in the Vercel cron logs.
 */
export async function GET() {
  const started = Date.now();

  let supabaseOk = false;
  let supabaseError: string | null = null;

  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from('domains').select('id').limit(1);
    if (error) {
      supabaseError = error.message;
    } else {
      supabaseOk = true;
    }
  } catch (e) {
    supabaseError = e instanceof Error ? e.message : 'unknown';
  }

  return NextResponse.json(
    {
      ok: supabaseOk,
      vercel_alive: true,
      supabase_alive: supabaseOk,
      supabase_error: supabaseError,
      durationMs: Date.now() - started,
      ts: new Date().toISOString(),
    },
    { status: 200 }
  );
}
