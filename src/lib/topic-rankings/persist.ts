/**
 * Run the full topic-rankings extraction + persist flow for one report.
 *
 * Used by:
 *   - src/app/api/reports/[id]/publish/route.ts (on every publish)
 *   - scripts/backfill-topic-rankings.ts (one-off repair for older
 *     reports whose original publish skipped this step)
 *
 * Behaviour:
 *   - For each of module 0 and module 1, call extractTopicsForModule
 *     and INSERT the results into `topic_rankings`.
 *   - existingLabels is grown across modules so module 1 can reuse
 *     labels minted by module 0.
 *   - Skips silently when:
 *       - apiKey missing (caller's job to log the policy choice)
 *       - report.content has no modules
 *       - a module produces zero topics
 *   - Returns counts so callers can log/exit-code on it.
 *   - Throws on DB insert errors so background pipelines surface them
 *     loudly (publish route catches; backfill script logs and continues).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReportContent } from '@/types/report';
import { extractTopicsForModule, type TopicEntry } from './extract';

export interface PersistResult {
  /** total rows inserted into topic_rankings for this report */
  inserted: number;
  /** per-module breakdown so the caller can log it */
  perModule: Record<number, number>;
  /** new labels minted during this run (for telemetry) */
  newLabels: string[];
}

export async function extractAndPersistTopicRankings(params: {
  supabase: SupabaseClient;
  reportId: string;
  domainId: string;
  weekLabel: string | null;
  content: ReportContent;
  apiKey: string;
}): Promise<PersistResult> {
  const { supabase, reportId, domainId, weekLabel, content, apiKey } = params;

  // Bootstrap with all labels seen in this domain, so we reuse them.
  const { data: existingTopics } = await supabase
    .from('topic_rankings')
    .select('topic_label')
    .eq('domain_id', domainId);

  const existingLabels = [
    ...new Set(
      (existingTopics || []).map((t: { topic_label: string }) => t.topic_label)
    ),
  ];
  const labelsBefore = new Set(existingLabels);

  const perModule: Record<number, number> = {};
  let inserted = 0;

  // Module 0 first, then 1 — so module 1 can reuse a label coined by module 0.
  for (const moduleIndex of [0, 1]) {
    if (!content.modules?.[moduleIndex]) {
      perModule[moduleIndex] = 0;
      continue;
    }

    const topics = await extractTopicsForModule(
      content,
      moduleIndex,
      existingLabels,
      apiKey
    );

    if (topics.length === 0) {
      perModule[moduleIndex] = 0;
      continue;
    }

    const rows = topics.map((t: TopicEntry) => ({
      report_id: reportId,
      domain_id: domainId,
      module_index: moduleIndex,
      topic_label: t.topic_label,
      rank: t.rank,
      week_label: weekLabel,
      raw_reason: t.raw_reason || null,
      raw_keywords: t.raw_keywords || null,
    }));

    const { error: insertErr } = await supabase
      .from('topic_rankings')
      .insert(rows);
    if (insertErr) {
      throw new Error(
        `topic_rankings insert failed for report=${reportId} module=${moduleIndex}: ${insertErr.message}`
      );
    }

    inserted += rows.length;
    perModule[moduleIndex] = rows.length;

    // Grow existingLabels so module 1 sees module 0's new labels.
    for (const t of topics) {
      if (!existingLabels.includes(t.topic_label)) {
        existingLabels.push(t.topic_label);
      }
    }
  }

  const newLabels = existingLabels.filter((l) => !labelsBefore.has(l));
  return { inserted, perModule, newLabels };
}
