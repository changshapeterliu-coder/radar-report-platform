import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentDomainIdServer } from '@/lib/domain/server';
import { loadReportsList, type ReportTypeFilter } from './loaders';
import ReportsListClient from './ReportsListClient';

/**
 * Reports list — Server Component.
 *
 * URL search params (?type=regular&q=foo&page=2) drive the query, so
 * back/forward navigation + sharable links work without extra wiring.
 * The client component only writes to the URL; the server re-serves.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseTypeFilter(raw: string | undefined): ReportTypeFilter {
  if (raw === 'regular' || raw === 'topic') return raw;
  return 'all';
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; q?: string; page?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const domainId = await getCurrentDomainIdServer();

  const sp = await searchParams;
  const typeFilter = parseTypeFilter(sp.type);
  const searchQuery = sp.q ?? '';
  const page = parsePage(sp.page);

  // No domain configured yet — render empty state via the client.
  if (!domainId) {
    return (
      <ReportsListClient
        data={{
          reports: [],
          totalCount: 0,
          page: 0,
          totalPages: 1,
          typeFilter,
          searchQuery,
        }}
      />
    );
  }

  const data = await loadReportsList({
    domainId,
    page,
    typeFilter,
    searchQuery,
  });

  return <ReportsListClient data={data} />;
}
