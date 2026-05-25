import { createServiceRoleClient } from '@/lib/supabase/service-role';
import type { Database } from '@/types/database';
import type { ReportContent } from '@/types/report';

/**
 * Server-side data loader for the dashboard RSC.
 *
 * Pulls everything needed for the first paint in one parallel batch so
 * the SSR'd HTML lands with content already populated — no client-side
 * fetch waterfall, no spinner blocking the screen after nav appears.
 *
 * Why service role:
 *   The dashboard is admin/team_member only (route is gated by middleware
 *   + the auth context). Skipping RLS here saves the per-query auth
 *   resolution roundtrip on every fetch. The user has already been
 *   authorized to see this domain by the time this runs (cookie read +
 *   page entry point).
 */

type ReportRow = Database['public']['Tables']['reports']['Row'];
type NewsRow = Database['public']['Tables']['news']['Row'];
type TopicRankingRow = Database['public']['Tables']['topic_rankings']['Row'];

export type TopicCanonicalLegendRow = Pick<
  Database['public']['Tables']['topic_canonicals']['Row'],
  'canonical_topic_key' | 'canonical_title_zh' | 'canonical_title_en'
>;

export interface DashboardData {
  reports: ReportRow[];
  latestNews: NewsRow[];
  topicRankings: TopicRankingRow[];
  topicCanonicals: TopicCanonicalLegendRow[];
}

/**
 * Number of past weekly reports kept on the dashboard (latest report
 * strip + the 8-week trend window). The trend chart visualizes weekly
 * rank movement — anything older is archive territory and lives on
 * /reports.
 */
const RECENT_REPORTS_LIMIT = 8;
const RECENT_NEWS_LIMIT = 10;

export async function loadDashboardData(
  domainId: string
): Promise<DashboardData> {
  const supabase = createServiceRoleClient();

  const [reportsRes, newsRes, topicRes, canonicalRes] = await Promise.all([
    supabase
      .from('reports')
      .select('*')
      .eq('domain_id', domainId)
      .eq('status', 'published')
      .eq('type', 'regular')
      .order('published_at', { ascending: false })
      .limit(RECENT_REPORTS_LIMIT),
    supabase
      .from('news')
      .select('*')
      .eq('domain_id', domainId)
      .order('is_pinned', { ascending: false })
      .order('published_at', { ascending: false })
      .limit(RECENT_NEWS_LIMIT),
    supabase
      .from('topic_rankings')
      .select(
        'id, report_id, domain_id, module_index, canonical_topic_key, rank, week_label, raw_reason, raw_keywords, created_at'
      )
      .eq('domain_id', domainId)
      .order('created_at', { ascending: true }),
    supabase
      .from('topic_canonicals')
      .select('canonical_topic_key, canonical_title_zh, canonical_title_en')
      .eq('domain_id', domainId),
  ]);

  return {
    reports: (reportsRes.data ?? []) as ReportRow[],
    latestNews: (newsRes.data ?? []) as NewsRow[],
    topicRankings: (topicRes.data ?? []) as TopicRankingRow[],
    topicCanonicals: (canonicalRes.data ?? []) as TopicCanonicalLegendRow[],
  };
}

/**
 * Re-export ReportContent type so the client component can use the same
 * shape without pulling another import.
 */
export type { ReportContent };
