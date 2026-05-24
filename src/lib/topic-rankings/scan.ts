/**
 * Weekly publish — build scanned-topics payload for the shared
 * canonicalization engine.
 *
 * Why this file is tiny and does NOT call any LLM:
 *   The whole point of this spec (`unify-topic-dictionary-across-pipelines`)
 *   is that label stabilization happens via the canonical dictionary
 *   (`topic_canonicals`) — not via a per-publish stabilizing LLM call. The
 *   weekly synthesizer already produced structured `topTopics[]` inside
 *   `report.content`; this module just transforms that structure into the
 *   `ScanTopic[]` shape the shared canonicalize prompt consumes.
 *
 * Field contract:
 *   The shared canonicalize prompt's `scanned_topics_json` placeholder only
 *   consumes three fields per topic: `topic_name_zh`, `summary_zh`,
 *   `keywords`. We populate only those. Other `ScanTopic` fields
 *   (`voice_volume`, `channel_counts`, `sample_quotes`, `source_links`,
 *   `hot_score`, `channels_observed`, `rank`) are produced by the daily
 *   scan engine and have no equivalent in the weekly synthesizer's
 *   `TopTopic` shape — so they are deliberately omitted. The structural
 *   cast at the bottom is sound because the only consumer
 *   (`runWeeklyCanonicalize` → `JSON.stringify` of the 3-field projection)
 *   never reads the omitted fields.
 *
 * Spec refs:
 *   Requirements: 1.4
 *   Design:       §scan.ts (weekly helper, no LLM call)
 */

import type { ReportContent, TopTopic } from '@/types/report';
import type { ScanTopic } from '@/lib/daily-alert/zod-schemas';

/**
 * Convert a single weekly module's `topTopics[]` into the `ScanTopic[]`
 * shape the shared canonicalize prompt expects.
 *
 * Returns `[]` when:
 *   - `moduleIndex` is out of range (no module at that index)
 *   - the module has no `topTopics` (undefined / empty array)
 *
 * Pure function — no side effects, no LLM call, no I/O.
 */
export function buildScannedTopicsFromModule(
  content: ReportContent,
  moduleIndex: number
): ScanTopic[] {
  const module = content.modules?.[moduleIndex];
  if (!module) return [];

  const topTopics = module.topTopics;
  if (!topTopics || topTopics.length === 0) return [];

  return topTopics.map((t: TopTopic) => ({
    topic_name_zh: t.topic,
    summary_zh: t.seller_discussion,
    keywords: t.keywords,
  })) as unknown as ScanTopic[];
}
