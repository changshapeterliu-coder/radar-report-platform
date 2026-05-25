import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentDomainIdServer } from '@/lib/domain/server';
import { loadDashboardData } from './loaders';
import DashboardClient from './DashboardClient';

/**
 * Dashboard page — Server Component.
 *
 * Loads everything the first paint needs in parallel on the server, so
 * the HTML response already carries the data. The browser doesn't have
 * to wait for JS to hydrate, hit the auth roundtrip, then fire 4 SQL
 * queries before content shows up — all of that now happens during the
 * server render.
 *
 * Auth gate: redirects to /login if no session. The (main) layout has
 * its own auth check, but server-side data loaders need an authenticated
 * caller too — and we want the redirect to happen BEFORE the heavy data
 * load runs, not after.
 *
 * Domain scope: read from a cookie (`radar-report-selected-domain`)
 * shared with the client `useDomain()` hook. When the user switches
 * domain, the client provider sets the cookie and triggers
 * router.refresh() → this RSC re-runs with the new scope.
 *
 * No `'use client'` here — interactivity (module tab, navigation, format
 * helpers) lives in `DashboardClient.tsx`.
 *
 * Spec / power refs:
 *   - power design-guidelines.md 5.2 Information Hierarchy + 6.3 Minimalist
 *   - ui-design-system.md §9.1 page header
 *   - This file: server data fetch + handoff to client component.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const domainId = await getCurrentDomainIdServer();

  // No domains in the system yet — render the empty-state shell. The
  // client component handles its own "no report" placeholder when
  // `data.reports` is empty, so passing an empty payload is enough.
  if (!domainId) {
    return (
      <DashboardClient
        data={{
          reports: [],
          latestNews: [],
          topicRankings: [],
          topicCanonicals: [],
        }}
      />
    );
  }

  const data = await loadDashboardData(domainId);

  return <DashboardClient data={data} />;
}
