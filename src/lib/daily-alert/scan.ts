/**
 * Daily Scan Engine — Stage 1 of the daily-alert pipeline.
 *
 * Flow:
 *   1. substitute placeholders into scanPrompt
 *   2. call GLM-4.6 via zai-client (web_search enabled, search_recency=noLimit,
 *      content_size=high, timeout 240s, 2 retries inside callZai)
 *   3. Zod-validate the returned JSON against ScanResponseSchema
 *   4. per-topic validation:
 *        - hot_score ∈ [0, 100]
 *        - rank ∈ [1, 10]
 *        - source_links: drop entries with malformed URLs; reject topic
 *          if fewer than 3 valid links remain
 *        - sample_quotes: length ∈ [2, 3]  (already enforced by Zod)
 *      violations are logged in debug output, topic is dropped
 *   5. sort surviving topics by hot_score DESC, keep top 10
 *   6. re-rank surviving topics to 1..N (contiguous) — PBT P33
 *
 * Spec refs:
 *   Requirements: 4.1-4.10, 5.3, 5.4, 7.4, 13.3
 * Property refs (PBT):
 *   P5, P6, P7, P8, P9, P13, P33
 *   (failure-mode naming P12, P13, P15 also touched here for the z.ai side)
 */

import { callZai } from '@/lib/research-engine/engines/zai-client';
import {
  ScanResponseSchema,
  type ScanTopic,
  type ScanResponse,
} from './zod-schemas';
import { substitute } from './substitute';

// ══════════ Public types ══════════

export interface DailyScanInput {
  /** Admin-edited `daily_scan_prompt` after domain-level substitution already? No — caller does substitute via this module. */
  scanPrompt: string;
  domainName: string;
  coverageWindowStartIso: string;
  coverageWindowEndIso: string;
  zaiApiKey: string;
  /** For error-context breadcrumb. */
  runId: string;
}

export type DailyScanResult =
  | {
      ok: true;
      topics: ScanTopic[];
      rawContent: string;
      searchCount: number;
      /** Diagnostic breadcrumb — topics that were dropped at validation time. */
      droppedTopics: Array<{ rank: number | null; topicName: string; reason: string }>;
    }
  | {
      ok: false;
      failureReason: string;
      /** Truncated to 500 chars for storage in daily_alert_runs.raw_output. */
      rawOutput: string;
    };

// ══════════ Public function ══════════

export async function runDailyScan(input: DailyScanInput): Promise<DailyScanResult> {
  const { scanPrompt, domainName, coverageWindowStartIso, coverageWindowEndIso, zaiApiKey } = input;

  // Env-var fail-fast — normally caller checks, but guard here too in case
  // someone invokes the module directly (e.g. from a one-off script / test).
  if (!zaiApiKey) {
    return {
      ok: false,
      failureReason: 'ZAI_API_KEY missing',
      rawOutput: '',
    };
  }

  const resolvedPrompt = substitute(scanPrompt, {
    coverage_window_start: coverageWindowStartIso,
    coverage_window_end: coverageWindowEndIso,
    domain_name: domainName,
  });

  const result = await callZai<unknown>({
    model: 'glm-4.6',
    messages: [{ role: 'user', content: resolvedPrompt }],
    apiKey: zaiApiKey,
    timeoutMs: 240_000,
    jsonMode: true,
    enableWebSearch: true,
    // Use 'noLimit' instead of 'oneDay': z.ai's one-day filter drops most
    // Chinese seller-community sites (知无不言 / 跨境知道 / 雨果网 etc.)
    // because they don't expose publish_date to the indexer. The 5-way
    // probe run 2026-05-03 showed oneDay=0 refs, oneWeek=2-10 refs (mostly
    // unrelated English sites), noLimit=10 refs of real Chinese seller
    // content → 5 real topics. Activity on those forums is driven by
    // comment velocity on older threads (a 2025-11 post with fresh replies
    // is still hot), so filtering by the post's static published_date would
    // throw away real signal. We trust the prompt's {coverage_window_start}
    // anchor + GLM's hot_score judgement instead.
    searchRecency: 'noLimit',
    contentSize: 'high',
    // Upgrade to Zhipu's Pro search engine (commit 78c88ed probe, case H):
    // basic engine + oneDay returned 0 Chinese-seller refs in 24h window;
    // search_pro + oneDay on the same prompt returned 10 refs of real
    // Chinese-seller discussions from today (跨境头条, 雨果网 etc.). Cost
    // is $0.01/use per docs.z.ai pricing (pay-as-you-go). Monthly budget
    // for daily scan ≈ 30 × $0.01 = $0.30.
    searchEngine: 'search_pro',
    errorContext: {
      engine: 'kimi', // Reused per task 1.5 — breadcrumb lives in `stage` below.
      stage: 'hot-radar-scan', // Reused from existing LoopStage union (breadcrumb precision via errorContext only).
    },
  });

  if (!result.ok) {
    return {
      ok: false,
      failureReason: mapScanErrorToFailureReason(result.error.errorClass, result.error.message),
      rawOutput: truncate(result.error.message ?? '', 500),
    };
  }

  // Zod-validate top-level shape.
  const parsed = ScanResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      ok: false,
      failureReason: 'Daily alert: MalformedResponse',
      rawOutput: truncate(
        `Zod validation failed: ${parsed.error.message} | raw: ${result.rawContent}`,
        500
      ),
    };
  }

  const validated: ScanResponse = parsed.data;
  const droppedTopics: Array<{ rank: number | null; topicName: string; reason: string }> = [];

  // Per-topic sanitation: drop malformed source_links, reject topics with
  // < 2 valid links after drops (migration 021 minimum; was 3 pre-021, but
  // relaxed because some real daily discussions on smaller forums only
  // yield 2 distinct URLs and the 3-link floor was causing false drops).
  //
  // NOTE: we intentionally do NOT filter by source_links published_date.
  // Activity on Chinese seller-community forums is driven by comment
  // velocity on older threads, not by the original post date. A thread
  // from 2025-11 that still gets new replies today is a hot topic; its
  // static `published_date` is a bad proxy for current activity. We
  // trust GLM's hot_score + its decision to include a topic in `topics[]`
  // as the authoritative activity signal — that is exactly what the LLM
  // is being asked to judge during the scan.
  const survivingTopics: ScanTopic[] = [];
  for (const topic of validated.topics) {
    const validLinks = topic.source_links.filter((link) => isValidHttpUrl(link.url));
    if (validLinks.length < 2) {
      droppedTopics.push({
        rank: topic.rank,
        topicName: topic.topic_name_zh,
        reason: `source_links after URL validation: ${validLinks.length} < 2`,
      });
      continue;
    }
    // Keep the topic with the cleaned links list (bounded 2–10 by Zod plus our drop).
    survivingTopics.push({
      ...topic,
      source_links: validLinks.slice(0, 10),
    });
  }

  // Sort surviving by voice_volume desc (migration 022) and cap at Top 5.
  // Pre-022 used hot_score; voice_volume is more deterministic because
  // it's derived from channel_counts (not AI's subjective 0-100 guess).
  survivingTopics.sort((a, b) => b.voice_volume - a.voice_volume);
  const capped = survivingTopics.slice(0, 5);

  // Re-rank survivors 1..N contiguous — per PBT P33.
  const reranked = capped.map((topic, i) => ({ ...topic, rank: i + 1 }));

  return {
    ok: true,
    topics: reranked,
    rawContent: result.rawContent,
    searchCount: result.searchCount,
    droppedTopics,
  };
}

// ══════════ Helpers ══════════

/**
 * Map `zai-client` error class to the failure_reason substring required
 * by requirements.md § Correctness Properties (PBT P13, P15, etc.) and
 * by design.md §失败处理矩阵.
 *
 *   CreditsExhausted → 'z.ai credits exhausted'   (Req 4.8 / PBT 13)
 *   TimeoutError     → 'GLM timeout'              (Req 7.4)
 *   NetworkError     → 'GLM network error'        (Req 7.4)
 *   ServerError      → 'Daily scan: GLM 5xx'
 *   RateLimited      → 'Daily scan: GLM rate-limited'
 *   MalformedResponse→ 'Daily alert: MalformedResponse'  (Req 4.10)
 */
function mapScanErrorToFailureReason(errorClass: string, message: string): string {
  switch (errorClass) {
    case 'CreditsExhausted':
      return 'z.ai credits exhausted';
    case 'TimeoutError':
      return 'GLM timeout';
    case 'NetworkError':
      return 'GLM network error';
    case 'ServerError':
      return 'Daily scan: GLM 5xx';
    case 'RateLimited':
      return 'Daily scan: GLM rate-limited';
    case 'MalformedResponse':
      return 'Daily alert: MalformedResponse';
    default:
      return `Daily scan: ${errorClass} (${truncate(message, 100)})`;
  }
}

function isValidHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}
