/**
 * Daily-alert persistence layer.
 *
 * Thin wrappers over the `persist_daily_alert` PL/pgSQL RPC (migration 015)
 * and a direct INSERT for the empty-day path.
 *
 * Uses the service role Supabase client to bypass RLS — this module runs
 * exclusively inside Inngest function steps, never inside a user-session
 * API route.
 *
 * Spec refs:
 *   Requirements: 6.1, 6.3, 6.4, 6.5, 9.5, 9.6, 9.7
 *   Design:       §persist.ts 接口, §RLS 策略 (service role bypass)
 * Property refs (PBT):
 *   P10 (auto-publish invariant), P11 (empty-day shape),
 *   P12 (failed run → zero alert rows — enforced by RPC transaction),
 *   P20, P25 (seen_count integrity via RPC), P43 (origin='daily_alert')
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role';
import type { CanonicalAssignment, ScanTopic } from '@/types/daily-alert';

// ══════════ Public types ══════════

export interface PersistInput {
  runId: string;
  domainId: string;
  /** 'YYYY-MM-DD' (Asia/Shanghai). */
  coverageWindowStartDate: string;
  scannedTopics: ScanTopic[];
  /** Same length as scannedTopics; assignments[i] classifies scannedTopics[i]. */
  canonicalAssignments: CanonicalAssignment[];
  /**
   * Keys already present in topic_canonicals for this domain BEFORE this run.
   * Passed through to the RPC as `p_existing_canonical_keys` so race-proof
   * ON CONFLICT DO NOTHING logic can skip INSERTing known-existing rows.
   */
  existingCanonicalKeys: Set<string>;
}

export interface PersistOutput {
  alertId: string;
  topicIds: string[];
  /** Keys actually minted by this run (ON CONFLICT-filtered). Used for translate fan-out. */
  newCanonicalKeys: string[];
}

export interface EmptyDayPersistInput {
  runId: string;
  domainId: string;
  coverageWindowStartDate: string;
}

export interface EmptyDayPersistOutput {
  alertId: string;
}

// ══════════ Public functions ══════════

/**
 * Atomically persist a daily alert run's scan + canonicalize output.
 *
 * Delegates the full transaction to the `persist_daily_alert` PL/pgSQL
 * function — see migration 015 for the RPC body. This module is a thin
 * wrapper that maps TS types to JSONB payloads and interprets the return.
 *
 * On RPC error: throws `Error('Persistence failed: <pg-message>')` so the
 * Inngest caller can pattern-match the failure_reason substring per
 * design.md §失败处理矩阵.
 */
export async function persistDailyAlertTransaction(
  input: PersistInput
): Promise<PersistOutput> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase.rpc('persist_daily_alert', {
    p_run_id: input.runId,
    p_domain_id: input.domainId,
    p_coverage_window_start_date: input.coverageWindowStartDate,
    p_scanned_topics: input.scannedTopics as unknown as object,
    p_canonical_assignments: input.canonicalAssignments as unknown as object,
    p_existing_canonical_keys: Array.from(input.existingCanonicalKeys),
  });

  if (error) {
    throw new Error(`Persistence failed: ${error.message}`);
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Persistence failed: RPC returned empty payload');
  }

  const payload = data as {
    alertId?: string;
    topicIds?: unknown;
    newCanonicalKeys?: unknown;
  };

  if (typeof payload.alertId !== 'string') {
    throw new Error('Persistence failed: RPC payload missing alertId');
  }
  if (!Array.isArray(payload.topicIds)) {
    throw new Error('Persistence failed: RPC payload topicIds is not an array');
  }
  if (!Array.isArray(payload.newCanonicalKeys)) {
    throw new Error('Persistence failed: RPC payload newCanonicalKeys is not an array');
  }

  return {
    alertId: payload.alertId,
    topicIds: payload.topicIds.map(String),
    newCanonicalKeys: payload.newCanonicalKeys.map(String),
  };
}

/**
 * Publish an empty-day alert: status='published', zero child topics,
 * a human-readable Chinese message so the team can verify the pipeline ran.
 *
 * No canonicalization invocation (Req 9.8 — skipped when topics=[]).
 * No news table writes. No translation job (empty_day_message_en is
 * null and remains null; admin can manually translate if they want).
 */
export async function persistEmptyDayAlert(
  input: EmptyDayPersistInput
): Promise<EmptyDayPersistOutput> {
  const supabase = createServiceRoleClient();

  const emptyDayMessageZh = '本日无显著热点话题，管线已正常完成扫描。';

  const { data, error } = await supabase
    .from('daily_hot_topic_alerts')
    .insert({
      domain_id: input.domainId,
      run_id: input.runId,
      coverage_window_start_date: input.coverageWindowStartDate,
      status: 'published',
      empty_day_message_zh: emptyDayMessageZh,
      empty_day_message_en: null,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Persistence failed (empty-day): ${error.message}`);
  }
  if (!data || typeof data.id !== 'string') {
    throw new Error('Persistence failed (empty-day): insert returned no id');
  }

  // Link the run to the empty-day alert so /admin/daily-alert-runs shows the link.
  const { error: updateError } = await supabase
    .from('daily_alert_runs')
    .update({ produced_alert_id: data.id })
    .eq('id', input.runId);

  if (updateError) {
    // Alert persisted OK but the link-back failed — throw so the caller
    // marks the run as failed. The alert row is a harmless orphan in that
    // rare case (no topics, benign).
    throw new Error(`Persistence failed (empty-day link-back): ${updateError.message}`);
  }

  return { alertId: data.id };
}

/**
 * Load all existing canonicals for a domain, used by the Canonicalize
 * Engine as input history. Returns rows as an array in insertion order
 * (by `first_seen_date ASC`) which keeps the JSON payload stable
 * across runs.
 */
export async function loadAllTopicCanonicalsForDomain(
  domainId: string
): Promise<Array<{
  canonical_topic_key: string;
  canonical_title_zh: string;
  canonical_description_zh: string;
  category_slug: string;
  secondary_axis_type: 'site' | 'category' | null;
  secondary_axis_value: string | null;
  first_seen_date: string;
  last_seen_date: string;
  seen_count: number;
  origin: 'daily_alert';
  canonical_title_en: string | null;
  canonical_description_en: string | null;
  id: string;
  domain_id: string;
  created_at: string;
  updated_at: string;
}>> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('topic_canonicals')
    .select('*')
    .eq('domain_id', domainId)
    .order('first_seen_date', { ascending: true });

  if (error) {
    throw new Error(`loadAllTopicCanonicalsForDomain failed: ${error.message}`);
  }
  return (data ?? []) as Array<{
    canonical_topic_key: string;
    canonical_title_zh: string;
    canonical_description_zh: string;
    category_slug: string;
    secondary_axis_type: 'site' | 'category' | null;
    secondary_axis_value: string | null;
    first_seen_date: string;
    last_seen_date: string;
    seen_count: number;
    origin: 'daily_alert';
    canonical_title_en: string | null;
    canonical_description_en: string | null;
    id: string;
    domain_id: string;
    created_at: string;
    updated_at: string;
  }>;
}
