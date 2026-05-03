/**
 * Zod schema re-exports + canonical-key normalizer for the daily-alert
 * business layer.
 *
 * Why this file re-exports:
 *   Business modules (scan.ts / canonicalize.ts / persist.ts / PBT tests)
 *   should only depend on `@/lib/daily-alert/*` — not reach into
 *   `@/types/daily-alert.ts`. This keeps the dependency graph one-way:
 *     src/lib/daily-alert/**  →  src/types/daily-alert.ts
 *
 * Spec refs:
 *   Requirements: 4.3, 5.3, 5.4, 9.10
 *   Design:       §canonicalize.ts 接口 / §TypeScript 类型定义
 * Property refs (PBT):
 *   P5, P6, P7, P8, P9, P19, P33
 */

export {
  CANONICAL_KEY_REGEX,
  ScanSampleQuoteSchema,
  ScanSourceLinkSchema,
  ScanTopicSchema,
  ScanResponseSchema,
  CanonicalAssignmentSchema,
  CanonicalizeResponseSchema,
} from '@/types/daily-alert';

export type {
  ScanResponse,
  ScanTopic,
  CanonicalAssignment,
  CanonicalizeResponse,
} from '@/types/daily-alert';

import { CANONICAL_KEY_REGEX } from '@/types/daily-alert';

/**
 * Normalize a canonical_topic_key string returned by the Canonicalize Engine
 * into the canonical form enforced by `CANONICAL_KEY_REGEX`.
 *
 * Strategy (conservative — "rescue the obvious, reject the rest"):
 *   1. Trim whitespace
 *   2. Lowercase the primary segment (everything before the first `::`).
 *      The secondary segment (after `::`) preserves case because site codes
 *      like `BR` / `CA` are case-sensitive by convention (see Glossary).
 *   3. Validate the normalized result against the regex. If it still
 *      fails, throw — the caller (canonicalize.ts) will convert this
 *      into a `'Canonicalization: malformed key'` run-level failure per
 *      Requirement 9.10.
 *
 * Examples:
 *   "  kyc-verification::BR  "  →  "kyc-verification::BR"           (ok)
 *   "KYC-Verification::BR"      →  "kyc-verification::BR"           (ok, primary lowercased)
 *   "account-health-score-rules" → "account-health-score-rules"     (ok, already clean)
 *   "kyc_verification::BR"      →  THROWS (underscore not allowed by regex)
 *   "kyc::verification::BR"     →  THROWS (multiple `::` segments not allowed)
 */
export function normalizeCanonicalKey(raw: string): string {
  const trimmed = raw.trim();
  const sepIdx = trimmed.indexOf('::');

  let normalized: string;
  if (sepIdx >= 0) {
    const primary = trimmed.slice(0, sepIdx).toLowerCase();
    const secondary = trimmed.slice(sepIdx + 2);
    normalized = `${primary}::${secondary}`;
  } else {
    normalized = trimmed.toLowerCase();
  }

  if (!CANONICAL_KEY_REGEX.test(normalized)) {
    throw new Error(
      `malformed canonical key: got "${truncate(raw, 80)}" (normalized to "${truncate(
        normalized,
        80
      )}")`
    );
  }
  return normalized;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}
