/**
 * Re-export module for the weekly topic-rankings business layer.
 *
 * Why this file exists:
 *   The weekly publish pipeline (`src/lib/topic-rankings/*` and
 *   `src/app/api/reports/[id]/publish/route.ts`) and the daily-alert
 *   pipeline (`src/lib/daily-alert/*`) share the SAME canonicalization
 *   prompt, the SAME `CanonicalizeResponseSchema` Zod tree, and the SAME
 *   `normalizeCanonicalKey` helper. Rather than fork the schema, we
 *   re-export from `@/lib/daily-alert/zod-schemas` so that:
 *
 *     1. There is exactly ONE source of truth for the canonicalize wire
 *        contract — schema drift between pipelines becomes impossible
 *        at compile time (Spec ref: Req 1.4).
 *     2. Modules under `src/lib/topic-rankings/*` import from a
 *        topic-rankings-local namespace, keeping the
 *        weekly-pipeline/daily-pipeline shared-but-not-coupled boundary
 *        explicit in the dependency graph.
 *
 * Spec refs:
 *   Requirements: 1.4, 5.5
 *   Design:       §`src/lib/topic-rankings/zod-schemas.ts` — NEW
 */

export {
  CANONICAL_KEY_REGEX,
  CanonicalizeResponseSchema,
  CanonicalAssignmentSchema,
  ScanTopicSchema,
  normalizeCanonicalKey,
} from '@/lib/daily-alert/zod-schemas';

export type {
  CanonicalAssignment,
  ScanTopic,
  CanonicalizeResponse,
} from '@/lib/daily-alert/zod-schemas';
