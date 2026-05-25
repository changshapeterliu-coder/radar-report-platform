import { createServiceRoleClient } from '@/lib/supabase/service-role';
import type { Database } from '@/types/database';

/**
 * Server-side data loader for the /reports/[id] viewer.
 *
 * Pulls the report row + the joined topic_rankings/topic_canonicals
 * payload in parallel, so the SSR'd HTML carries everything the
 * Category column needs.
 */

export type ReportRow = Database['public']['Tables']['reports']['Row'];

/**
 * Joined `topic_rankings` row carrying its canonical title pair via
 * Supabase nested select. The `topic_canonicals` field can arrive as
 * `null` (no FK match), a single object, or an array depending on the
 * postgrest plan — caller normalizes on read.
 */
export type RankingWithCanonical = {
  module_index: number;
  rank: number;
  canonical_topic_key: string | null;
  topic_canonicals:
    | { canonical_title_zh: string; canonical_title_en: string | null }
    | { canonical_title_zh: string; canonical_title_en: string | null }[]
    | null;
};

export interface ReportViewerData {
  report: ReportRow;
  rankings: RankingWithCanonical[];
}

export type ReportViewerLoadResult =
  | { kind: 'ok'; data: ReportViewerData }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string };

export async function loadReportViewer(
  reportId: string
): Promise<ReportViewerLoadResult> {
  const supabase = createServiceRoleClient();

  const [reportRes, rankingsRes] = await Promise.all([
    supabase.from('reports').select('*').eq('id', reportId).maybeSingle(),
    supabase
      .from('topic_rankings')
      .select(
        'module_index, rank, canonical_topic_key, topic_canonicals(canonical_title_zh, canonical_title_en)'
      )
      .eq('report_id', reportId),
  ]);

  if (reportRes.error) {
    return { kind: 'error', message: reportRes.error.message };
  }
  if (!reportRes.data) {
    return { kind: 'not_found' };
  }

  return {
    kind: 'ok',
    data: {
      report: reportRes.data as ReportRow,
      rankings: (rankingsRes.data ?? []) as RankingWithCanonical[],
    },
  };
}
