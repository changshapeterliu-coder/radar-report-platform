/**
 * Weekly publish — atomic persistence of topic-rankings.
 *
 * Thin wrapper over the `persist_weekly_topic_rankings` PL/pgSQL RPC
 * (migrations 026b → 026c). Models on the daily-alert pipeline's
 * `persistDailyAlertTransaction` (`src/lib/daily-alert/persist.ts`) so
 * both pipelines write through a single-transaction RPC shape.
 *
 * What the RPC body does (in one transaction — see migration 026c):
 *   1. Validate input shapes (per-module length parity, module-key set parity)
 *   2. DELETE FROM topic_rankings WHERE report_id = p_report_id   (Req 7.4)
 *   3. UPSERT topic_canonicals (origin='weekly_report') with
 *      ON CONFLICT (domain_id, canonical_topic_key) DO NOTHING — race-safe
 *   4. UPDATE topic_canonicals.last_seen_date + seen_count for every
 *      referenced canonical key (Req 2.4)
 *   5. INSERT topic_rankings rows for every kept assignment, populating
 *      `canonical_topic_key` only — readers resolve display labels via
 *      the (domain_id, canonical_topic_key) composite FK into
 *      `topic_canonicals`. The legacy `topic_label` / `topic_label_zh`
 *      dual-write was removed in PR-F (migration 026c, Req 9.1(f));
 *      this TS payload never carried the legacy label fields.
 *
 * On RPC error: throws `Error('weekly canonicalize: persistence failed:
 * <pg-message>')` so the route handler can pattern-match per Req 11.6.
 * The RPC's exception handler raises with that prefix; we forward it.
 *
 * What this module DOES NOT do anymore (vs the legacy
 * `extractAndPersistTopicRankings`):
 *   - No LLM call. Canonicalization happens upstream in
 *     `src/lib/topic-rankings/canonicalize.ts` (Req 1.4).
 *   - No `existingLabels` bootstrap query. The caller passes the
 *     already-loaded `existingCanonicalKeys` snapshot, mirroring the
 *     daily pipeline's contract.
 *   - No `replaceExisting` flag and no per-module raw-Chinese-label
 *     fallback. Re-publish always replaces (Req 7.4); legacy fallback
 *     is gone because the RPC resolves labels from `topic_canonicals`.
 *
 * Spec refs:
 *   Requirements: 7.4, 14.3, 15.2
 *   Design:       §`src/lib/topic-rankings/persist.ts` — MAJOR REFACTOR
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CanonicalAssignment,
  ScanTopic,
} from '@/lib/daily-alert/zod-schemas';

// ══════════ Public types ══════════

/**
 * Input payload for `persistWeeklyTopicRankings`. Mirrors the RPC's
 * 6 parameters one-to-one, plus the Supabase service-role client the
 * caller must pre-construct (the RPC is `GRANT EXECUTE ... TO service_role`
 * only — see migration 026b).
 */
export interface PersistWeeklyTopicRankingsArgs {
  /**
   * Service-role Supabase client. The RPC is locked to `service_role` —
   * passing an authenticated/anon client will fail with "permission denied".
   */
  supabase: SupabaseClient;

  reportId: string;
  domainId: string;
  weekLabel: string | null;

  /**
   * Per-module scanned-topics, keyed by module index ('0' / '1'). Built
   * by `buildScannedTopicsFromModule(...)`. The arrays carry only the
   * canonicalize-relevant fields (`topic_name_zh`, `summary_zh`,
   * `keywords`); the RPC reads `summary_zh` and `keywords` for the
   * `raw_reason` / `raw_keywords` columns of `topic_rankings`.
   */
  scannedTopicsByModule: Record<number, ScanTopic[]>;

  /**
   * Per-module canonical assignments, keyed by module index. Each
   * `assignmentsByModule[k]` MUST be the same length as
   * `scannedTopicsByModule[k]` — the RPC validates this and raises
   * 'persist_weekly_topic_rankings: module N length mismatch' otherwise.
   * Both `keep` and `drop` decisions are passed through; the RPC skips
   * drops when building `topic_rankings` rows but still validates them.
   */
  assignmentsByModule: Record<number, CanonicalAssignment[]>;

  /**
   * Snapshot of canonical keys already present in `topic_canonicals`
   * for this domain BEFORE this run. The RPC uses this to decide
   * whether an `is_new_canonical=true` assignment should attempt an
   * INSERT (with race-safe ON CONFLICT DO NOTHING) or skip directly
   * to the reuse-counter branch. Race-loser inserts (RETURNING NULL)
   * are still handled internally.
   */
  existingCanonicalKeys: Set<string>;
}

/**
 * Typed equivalent of the `persist_weekly_topic_rankings` RPC's JSONB
 * return payload.
 */
export interface PersistWeeklyTopicRankingsResult {
  /** Total rows inserted into `topic_rankings` across all modules. */
  inserted: number;

  /**
   * Per-module insert count, keyed by module index as a string ('0' /
   * '1') — matches the RPC's JSONB-key shape rather than translating
   * to numeric keys.
   */
  perModule: Record<string, number>;

  /**
   * Canonical keys actually minted by this run (after race-safe
   * ON CONFLICT DO NOTHING filter). The publish route fans out a
   * translate event per key (Req 16.1).
   */
  newCanonicalKeys: string[];

  /**
   * Canonical keys reused (already present pre-run, or minted by a
   * concurrent run that won the race). Telemetry only.
   */
  reusedCanonicalKeys: string[];
}

// ══════════ Public function ══════════

/**
 * Atomically persist a weekly publish run's canonicalize output.
 *
 * Delegates the full transaction to the `persist_weekly_topic_rankings`
 * PL/pgSQL function — see `supabase/migrations/026c_persist_weekly_topic_rankings_drop_legacy_label.sql`
 * for the current RPC body (originally created in 026b; 026c removed the
 * legacy label dual-write per PR-F). This module is a thin wrapper that
 * maps TS types to JSONB payloads and interprets the return.
 *
 * On RPC error: throws `Error('weekly canonicalize: persistence failed:
 * <pg-message>')`. The pg side wraps its own exception handler around
 * the whole body so any failure rolls back the transaction; no half-
 * persisted state is ever visible to readers.
 */
export async function persistWeeklyTopicRankings(
  args: PersistWeeklyTopicRankingsArgs
): Promise<PersistWeeklyTopicRankingsResult> {
  const {
    supabase,
    reportId,
    domainId,
    weekLabel,
    scannedTopicsByModule,
    assignmentsByModule,
    existingCanonicalKeys,
  } = args;

  const { data, error } = await supabase.rpc('persist_weekly_topic_rankings', {
    p_report_id: reportId,
    p_domain_id: domainId,
    p_week_label: weekLabel,
    // Cast through `unknown` because supabase-js types `JSONB` parameters
    // as `Json` and our Zod-derived discriminated unions don't satisfy
    // that nominal alias structurally — at runtime we send plain JSON.
    p_topics_by_module: scannedTopicsByModule as unknown as object,
    p_assignments_by_module: assignmentsByModule as unknown as object,
    p_existing_canonical_keys: Array.from(existingCanonicalKeys),
  });

  if (error) {
    throw new Error(`weekly canonicalize: persistence failed: ${error.message}`);
  }
  if (!data || typeof data !== 'object') {
    throw new Error(
      'weekly canonicalize: persistence failed: RPC returned empty payload'
    );
  }

  const payload = data as {
    inserted?: unknown;
    perModule?: unknown;
    newCanonicalKeys?: unknown;
    reusedCanonicalKeys?: unknown;
  };

  if (typeof payload.inserted !== 'number') {
    throw new Error(
      'weekly canonicalize: persistence failed: RPC payload missing inserted'
    );
  }
  if (
    !payload.perModule ||
    typeof payload.perModule !== 'object' ||
    Array.isArray(payload.perModule)
  ) {
    throw new Error(
      'weekly canonicalize: persistence failed: RPC payload perModule is not an object'
    );
  }
  if (!Array.isArray(payload.newCanonicalKeys)) {
    throw new Error(
      'weekly canonicalize: persistence failed: RPC payload newCanonicalKeys is not an array'
    );
  }
  if (!Array.isArray(payload.reusedCanonicalKeys)) {
    throw new Error(
      'weekly canonicalize: persistence failed: RPC payload reusedCanonicalKeys is not an array'
    );
  }

  // Normalize perModule values to numbers — JSONB integers come through
  // as JS numbers already, but be defensive in case the RPC ever returns
  // strings (e.g. via a future jsonb_build_object refactor).
  const perModule: Record<string, number> = {};
  for (const [k, v] of Object.entries(
    payload.perModule as Record<string, unknown>
  )) {
    perModule[k] = typeof v === 'number' ? v : Number(v);
  }

  return {
    inserted: payload.inserted,
    perModule,
    newCanonicalKeys: payload.newCanonicalKeys.map(String),
    reusedCanonicalKeys: payload.reusedCanonicalKeys.map(String),
  };
}
