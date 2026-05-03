/**
 * Daily Canonicalize Engine — Stage 2 of the daily-alert pipeline.
 *
 * Called exactly once per successful scan with N > 0 topics. Classifies
 * each scanned topic against the full history of `topic_canonicals` rows
 * for this domain, producing one `CanonicalAssignment` per scanned topic.
 *
 * This call has `enableWebSearch: false` — pure reasoning over the two
 * input lists. No external search needed; the AI reads the provided
 * dictionary + today's topics and matches (or mints a new key).
 *
 * Failure model (Req 9.9): any failure here aborts the entire run — no
 * half-persisted alert is allowed.
 *
 * Spec refs:
 *   Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.8, 9.9, 9.10, 13.4
 * Property refs (PBT):
 *   P15 — Failure-mode naming 'Canonicalization failed'
 *   P19 — Canonical key regex
 *   P23, P24 — Novelty flag (flag itself computed by novelty.ts, this
 *              module only passes through AI's self-report)
 */

import { callZai } from '@/lib/research-engine/engines/zai-client';
import {
  CanonicalizeResponseSchema,
  type CanonicalAssignment,
  type ScanTopic,
  normalizeCanonicalKey,
} from './zod-schemas';
import type { TopicCanonicalRow } from '@/types/daily-alert';
import { substitute } from './substitute';

// ══════════ Public types ══════════

export interface DailyCanonicalizeInput {
  canonPrompt: string;
  scannedTopics: ScanTopic[];
  /** Full list of existing canonicals for this domain — not limited. */
  existingCanonicals: TopicCanonicalRow[];
  domainName: string;
  zaiApiKey: string;
  runId: string;
}

export type DailyCanonicalizeResult =
  | {
      ok: true;
      /** One assignment per scannedTopic (same index). */
      assignments: CanonicalAssignment[];
      rawContent: string;
    }
  | {
      ok: false;
      failureReason: string;
      rawOutput: string;
    };

// ══════════ Public function ══════════

export async function runDailyCanonicalize(
  input: DailyCanonicalizeInput
): Promise<DailyCanonicalizeResult> {
  const { canonPrompt, scannedTopics, existingCanonicals, domainName, zaiApiKey } = input;

  if (!zaiApiKey) {
    return { ok: false, failureReason: 'ZAI_API_KEY missing', rawOutput: '' };
  }

  // Construct the two JSON arrays the prompt will consume.
  // scanned_topics_json: narrow shape to give the engine exactly what it needs
  // to classify; extra fields (source_links / sample_quotes) are noise for
  // classification, so we strip them.
  const scannedTopicsJson = JSON.stringify(
    scannedTopics.map((topic, index) => ({
      scanned_topic_index: index,
      topic_name_zh: topic.topic_name_zh,
      summary_zh: topic.summary_zh,
      keywords: topic.keywords,
    }))
  );

  // existing_canonicals_json: narrow to the classification-relevant fields.
  const existingCanonicalsJson = JSON.stringify(
    existingCanonicals.map((row) => ({
      canonical_topic_key: row.canonical_topic_key,
      canonical_title_zh: row.canonical_title_zh,
      canonical_description_zh: row.canonical_description_zh,
      category_slug: row.category_slug,
      secondary_axis_type: row.secondary_axis_type,
      secondary_axis_value: row.secondary_axis_value,
    }))
  );

  const resolvedPrompt = substitute(canonPrompt, {
    scanned_topics_json: scannedTopicsJson,
    existing_canonicals_json: existingCanonicalsJson,
    domain_name: domainName,
  });

  const result = await callZai<unknown>({
    model: 'glm-4.6',
    messages: [{ role: 'user', content: resolvedPrompt }],
    apiKey: zaiApiKey,
    timeoutMs: 90_000,
    jsonMode: true,
    enableWebSearch: false, // ← Key design: classification is reasoning, not search.
    errorContext: {
      engine: 'kimi',
      stage: 'hot-radar-scan', // reused breadcrumb slot; real specificity is in failure_reason prefix
    },
  });

  if (!result.ok) {
    return {
      ok: false,
      failureReason: `Canonicalization failed: ${mapCanonErrorToSubReason(
        result.error.errorClass
      )}`,
      rawOutput: truncate(result.error.message ?? '', 500),
    };
  }

  const parsed = CanonicalizeResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      ok: false,
      failureReason: 'Canonicalization failed: MalformedResponse',
      rawOutput: truncate(
        `Zod validation failed: ${parsed.error.message} | raw: ${result.rawContent}`,
        500
      ),
    };
  }

  const rawAssignments = parsed.data.assignments;

  // Completeness check — one assignment per scanned topic.
  if (rawAssignments.length !== scannedTopics.length) {
    return {
      ok: false,
      failureReason: `Canonicalization failed: missing assignments (got ${rawAssignments.length}, expected ${scannedTopics.length})`,
      rawOutput: truncate(result.rawContent, 500),
    };
  }

  // Key normalization + completeness-by-index check.
  const seenIndices = new Set<number>();
  const normalized: CanonicalAssignment[] = [];

  for (const assignment of rawAssignments) {
    const idx = assignment.scanned_topic_index;
    if (idx < 0 || idx >= scannedTopics.length) {
      return {
        ok: false,
        failureReason: `Canonicalization failed: out-of-range scanned_topic_index ${idx}`,
        rawOutput: truncate(result.rawContent, 500),
      };
    }
    if (seenIndices.has(idx)) {
      return {
        ok: false,
        failureReason: `Canonicalization failed: duplicate scanned_topic_index ${idx}`,
        rawOutput: truncate(result.rawContent, 500),
      };
    }
    seenIndices.add(idx);

    // Normalize the key (lowercase primary segment, trim); throws if
    // it still doesn't match the regex.
    let normalizedKey: string;
    try {
      normalizedKey = normalizeCanonicalKey(assignment.canonical_topic_key);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        failureReason: `Canonicalization: malformed key (${msg})`,
        rawOutput: truncate(result.rawContent, 500),
      };
    }

    normalized.push({
      ...assignment,
      canonical_topic_key: normalizedKey,
    });
  }

  // Sort by scanned_topic_index so caller can zip with scannedTopics[i].
  normalized.sort((a, b) => a.scanned_topic_index - b.scanned_topic_index);

  return {
    ok: true,
    assignments: normalized,
    rawContent: result.rawContent,
  };
}

// ══════════ Helpers ══════════

function mapCanonErrorToSubReason(errorClass: string): string {
  switch (errorClass) {
    case 'CreditsExhausted':
      return 'z.ai credits exhausted';
    case 'TimeoutError':
      return 'GLM timeout';
    case 'NetworkError':
      return 'GLM network error';
    case 'ServerError':
      return 'GLM 5xx';
    case 'RateLimited':
      return 'GLM rate-limited';
    case 'MalformedResponse':
      return 'MalformedResponse';
    default:
      return errorClass;
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}
