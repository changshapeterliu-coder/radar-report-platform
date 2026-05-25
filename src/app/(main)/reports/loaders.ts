import { createServiceRoleClient } from '@/lib/supabase/service-role';
import type { Database } from '@/types/database';

/**
 * Server-side data loader for the /reports list page.
 *
 * Reads filter / search / page from URL search params and runs the
 * Supabase query on the server. Lets the dashboard's URL serve as the
 * single source of truth for pagination state — back/forward navigation
 * + sharable links are free side effects.
 *
 * Why service role: the page is auth-gated and `published` rows are
 * domain-public to all team members, so the per-row RLS check just
 * adds latency.
 */

export type ReportRow = Database['public']['Tables']['reports']['Row'];

export type ReportTypeFilter = 'all' | 'regular' | 'topic';

export const PAGE_SIZE = 10;

export interface ReportsListData {
  reports: ReportRow[];
  totalCount: number;
  page: number;
  totalPages: number;
  typeFilter: ReportTypeFilter;
  searchQuery: string;
}

export interface ReportsListInput {
  domainId: string;
  page: number;
  typeFilter: ReportTypeFilter;
  searchQuery: string;
}

export async function loadReportsList(
  input: ReportsListInput
): Promise<ReportsListData> {
  const { domainId, page, typeFilter, searchQuery } = input;
  const supabase = createServiceRoleClient();

  let reports: ReportRow[] = [];
  let totalCount = 0;

  if (searchQuery.trim()) {
    // RPC search returns the full domain-scoped match set; paginate
    // + filter client-side here on the server.
    const { data } = await supabase.rpc('search_reports', {
      search_query: searchQuery.trim(),
      domain_filter: domainId,
    });
    let filtered = (data ?? []) as ReportRow[];
    if (typeFilter !== 'all') {
      filtered = filtered.filter((r) => r.type === typeFilter);
    }
    totalCount = filtered.length;
    reports = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  } else {
    let query = supabase
      .from('reports')
      .select('*', { count: 'exact' })
      .eq('domain_id', domainId)
      .eq('status', 'published')
      .order('published_at', { ascending: false });

    if (typeFilter !== 'all') {
      query = query.eq('type', typeFilter);
    }

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    query = query.range(from, to);

    const { data, count } = await query;
    reports = (data ?? []) as ReportRow[];
    totalCount = count ?? 0;
  }

  return {
    reports,
    totalCount,
    page,
    totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
    typeFilter,
    searchQuery,
  };
}
