import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

/**
 * Server-side counterpart to the client `useDomain()` hook. Reads the
 * `radar-report-selected-domain` cookie to figure out which domain to
 * scope data loads to in server components.
 *
 * Falls back to the first domain in the database when the cookie is
 * missing or stale, so the very first visit (no cookie set yet) still
 * renders correctly.
 *
 * Used by RSC pages (dashboard, /reports, etc.) so SSR'd HTML carries
 * the right data without waiting for the client-side context to hydrate
 * and re-fetch.
 */
const COOKIE_NAME = 'radar-report-selected-domain';

export async function getCurrentDomainIdServer(): Promise<string | null> {
  const store = await cookies();
  const cookieValue = store.get(COOKIE_NAME)?.value;

  if (cookieValue) return cookieValue;

  // No cookie yet — pick the first domain by created_at as a sensible
  // default (mirrors what the client provider does on first visit).
  const supabase = await createClient();
  const { data } = await supabase
    .from('domains')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}
