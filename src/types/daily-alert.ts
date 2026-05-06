/**
 * Daily Hot-Topic Alert — business-layer TypeScript types.
 *
 * Source of truth for:
 *   - DB Row shapes (narrow, V1-specific)
 *   - Zod schemas that validate GLM-4.6 JSON responses (scan + canonicalize)
 *   - API payload shapes returned by `/api/alerts` and `/api/alerts/by-date/[date]`
 *
 * Spec references:
 *   - `.kiro/specs/daily-hot-topic-alert/requirements.md` § "Requirement 5:
 *     Daily Hot Topic Schema" (Req 5.1) and § "Requirement 9: Topic
 *     Canonicalization" (Req 9.3)
 *   - `.kiro/specs/daily-hot-topic-alert/design.md` § "TypeScript 类型定义"
 *     (the exhaustive, authoritative type listing copied verbatim below)
 *   - `.kiro/specs/daily-hot-topic-alert/design.md` § "Correctness Properties
 *     → Test Fixtures Mapping" (the Zod schemas are the structural truth that
 *     PBT generators produce against; property tests P5/P6/P7/P8/P9 assert
 *     round-trip equivalence against these very schemas)
 *
 * Relationship to `src/types/database.ts`:
 *   `src/types/database.ts` is the Supabase-shaped data-layer typing (the
 *   `Database` object shaped as `{ Tables: { X: { Row, Insert, Update } } }`).
 *   This file is the **business-layer** typing: a narrower, application-specific
 *   companion (GLM response validators, API payloads, UI-friendly Row shapes).
 *   Task 1.7 will extend `database.ts` with Row/Insert/Update triples for the
 *   five new tables; the two files coexist and neither supersedes the other.
 *
 * V1 field constraints encoded in the types:
 *   - `TopicCanonicalRow.origin` is the string literal `'daily_alert'` because
 *     V1 has only one writer. A future weekly-integration spec will widen it.
 *   - `DailyHotTopicAlertRow.status` is the string literal `'published'` — the
 *     DB CHECK enforces this and daily alerts never pass through a draft stage
 *     (Requirement 6.2).
 */

import { z } from 'zod';

// ══════════ Section 1: DB Row Types ══════════

export interface DailyAlertConfigRow {
  id: string;
  domain_id: string;
  enabled: boolean;
  time_of_day: string; // 'HH:MM'
  timezone: 'Asia/Shanghai';
  created_at: string;
  updated_at: string;
}

export interface DailyAlertRunRow {
  id: string;
  domain_id: string;
  trigger_type: 'scheduled' | 'manual';
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  coverage_window_start_date: string; // 'YYYY-MM-DD'
  coverage_window_start: string; // ISO
  coverage_window_end: string; // ISO
  produced_alert_id: string | null;
  topic_count: number | null;
  new_canonical_count: number | null;
  failure_reason: string | null;
  raw_output: string | null;
  triggered_at: string;
  completed_at: string | null;
}

export interface DailyHotTopicAlertRow {
  id: string;
  domain_id: string;
  run_id: string;
  coverage_window_start_date: string;
  status: 'published';
  empty_day_message_zh: string | null;
  empty_day_message_en: string | null;
  published_at: string;
  created_at: string;
}

export interface DailyHotTopicRow {
  id: string;
  alert_id: string;
  domain_id: string;
  topic_name_zh: string;
  topic_name_en: string | null;
  keywords: string[];
  sample_quotes: Array<{ text: string; source_label: string }>;
  source_links: Array<{
    title: string;
    url: string;
    source_label: string;
    published_date: string | null;
  }>;
  hot_score: number;
  summary_zh: string;
  summary_en: string | null;
  rank: number;
  canonical_topic_key: string;
  is_new_canonical: boolean;
  created_at: string;
}

export interface TopicCanonicalRow {
  id: string;
  domain_id: string;
  canonical_topic_key: string;
  canonical_title_zh: string;
  canonical_title_en: string | null;
  canonical_description_zh: string;
  canonical_description_en: string | null;
  category_slug: string;
  secondary_axis_type: 'site' | 'category' | null;
  secondary_axis_value: string | null;
  first_seen_date: string;
  last_seen_date: string;
  seen_count: number;
  origin: 'daily_alert'; // V1 literal — widened by a future spec
  created_at: string;
  updated_at: string;
}

// ══════════ Section 2: GLM Response Zod Schemas ══════════

/**
 * Canonical topic key regex — used by Zod schemas below and re-exported so
 * business modules (scan.ts, canonicalize.ts, normalizeCanonicalKey) can
 * validate against the same pattern. Format:
 *   `{category_slug}` or `{category_slug}::{secondary_axis_value}`
 * where primary segment is lowercase+digits+hyphen, and the optional
 * secondary segment after `::` is case-sensitive (marketplace codes like `BR`,
 * `CA` are upper-case; product-category slugs like `toys-battery` are lower).
 */
export const CANONICAL_KEY_REGEX = /^[a-z0-9-]+(::[A-Za-z0-9-]+)?$/;

export const ScanSampleQuoteSchema = z.object({
  text: z.string().min(1).max(200),
  source_label: z.string().min(1).max(50),
});

export const ScanSourceLinkSchema = z.object({
  title: z.string().min(1),
  url: z.url(),
  source_label: z.string().min(1).max(50),
  published_date: z.string().nullable(),
});

export const ScanTopicSchema = z.object({
  rank: z.number().int().min(1).max(10),
  topic_name_zh: z.string().min(1).max(40),
  keywords: z.array(z.string().min(1)).min(1).max(5),
  // Three evidence fields below are *structural forcing functions*: the AI
  // can only fill them with ≥2 items if it actually executed a web_search
  // that returned ≥2 distinct results. Lowering any of these from 2 to 1
  // would reopen the 2026-05-03 fabrication mode (AI ignoring the tool).
  // Per Principle 2: enforce search at the schema layer, not via prompt hope.
  sample_quotes: z.array(ScanSampleQuoteSchema).min(2).max(3),
  source_links: z.array(ScanSourceLinkSchema).min(2).max(10),
  discussion_channels: z.array(z.string().min(1).max(50)).min(2).max(8),
  hot_score: z.number().int().min(0).max(100),
  summary_zh: z.string().min(1).max(400),
});

export const ScanResponseSchema = z.object({
  topics: z.array(ScanTopicSchema).max(10),
});

export type ScanResponse = z.infer<typeof ScanResponseSchema>;
export type ScanTopic = z.infer<typeof ScanTopicSchema>;

// Canonicalize response — discriminated union on `decision`, with the
// `keep` branch further discriminated on `is_new_canonical`.
//
// Post-search bucket filter (as of migration 021): canonicalize also acts
// as a business-focus gate. A scanned topic that does NOT belong to either
// "Account Suspension" (account-level consequence) or "Listing Takedown"
// (listing-level consequence) is returned with `decision: 'drop'` + a
// `drop_reason`, and will NOT be persisted into daily_hot_topics.
//
// Drop branch: everything except scanned_topic_index/decision/drop_reason
// is explicitly null so the AI cannot accidentally smuggle in a canonical
// assignment via a dropped topic.
//
// Keep branches: require `bucket` to be one of the two literals, never null.
//
// This schema is the sole place where the 3-way shape is enforced; the
// discriminated union makes Zod reject any mixed/inconsistent shape at
// parse time (e.g. decision='drop' with a non-null canonical_topic_key).

const CanonicalAssignmentDropSchema = z.object({
  scanned_topic_index: z.number().int().nonnegative(),
  decision: z.literal('drop'),
  bucket: z.null(),
  drop_reason: z.string().min(1).max(300),
  canonical_topic_key: z.null(),
  is_new_canonical: z.literal(false),
  category_slug: z.null(),
  secondary_axis_type: z.null(),
  secondary_axis_value: z.null(),
});

const CanonicalAssignmentReuseSchema = z.object({
  scanned_topic_index: z.number().int().nonnegative(),
  decision: z.literal('keep'),
  bucket: z.enum(['account_suspension', 'listing_takedown']),
  drop_reason: z.null(),
  canonical_topic_key: z.string().regex(CANONICAL_KEY_REGEX),
  is_new_canonical: z.literal(false),
  category_slug: z.string().regex(/^[a-z0-9-]+$/),
  secondary_axis_type: z.enum(['site', 'category']).nullable(),
  secondary_axis_value: z.string().nullable(),
});

const CanonicalAssignmentNewSchema = z.object({
  scanned_topic_index: z.number().int().nonnegative(),
  decision: z.literal('keep'),
  bucket: z.enum(['account_suspension', 'listing_takedown']),
  drop_reason: z.null(),
  canonical_topic_key: z.string().regex(CANONICAL_KEY_REGEX),
  is_new_canonical: z.literal(true),
  category_slug: z.string().regex(/^[a-z0-9-]+$/),
  secondary_axis_type: z.enum(['site', 'category']).nullable(),
  secondary_axis_value: z.string().nullable(),
  canonical_title_zh: z.string().min(1).max(30),
  canonical_description_zh: z.string().min(30).max(400),
});

// Nested discriminated union: first split on decision (drop vs keep),
// then inside 'keep' split on is_new_canonical.
const CanonicalAssignmentKeepSchema = z.discriminatedUnion('is_new_canonical', [
  CanonicalAssignmentReuseSchema,
  CanonicalAssignmentNewSchema,
]);

export const CanonicalAssignmentSchema = z.discriminatedUnion('decision', [
  CanonicalAssignmentDropSchema,
  CanonicalAssignmentKeepSchema,
]);

export const CanonicalizeResponseSchema = z.object({
  assignments: z.array(CanonicalAssignmentSchema),
});

export type CanonicalAssignment = z.infer<typeof CanonicalAssignmentSchema>;
export type CanonicalizeResponse = z.infer<typeof CanonicalizeResponseSchema>;

// ══════════ Section 3: API Payload Types ══════════

export interface AlertsOverviewResponse {
  window: { startDate: string; endDate: string };
  overview: Array<{
    date: string;
    weekday: string;
    status: 'published' | 'failed' | 'no-run';
    topic_count: number | null;
    top_topic_preview: Array<{
      topic_name_zh: string;
      topic_name_en: string | null;
      is_new_canonical: boolean;
    }>;
  }>;
}

export type DayDetailResponse =
  | { kind: 'no-run' }
  | {
      kind: 'empty-day';
      alert: {
        id: string;
        published_at: string;
        empty_day_message_zh: string | null;
        empty_day_message_en: string | null;
      };
    }
  | {
      kind: 'published';
      alert: {
        id: string;
        published_at: string;
        coverage_window_start_date: string;
      };
      topics: DailyHotTopicFull[];
    };

export interface DailyHotTopicFull extends DailyHotTopicRow {
  canonical: {
    canonical_topic_key: string;
    canonical_title_zh: string;
    canonical_title_en: string | null;
    canonical_description_zh: string;
    canonical_description_en: string | null;
    secondary_axis_type: 'site' | 'category' | null;
    secondary_axis_value: string | null;
  };
}
