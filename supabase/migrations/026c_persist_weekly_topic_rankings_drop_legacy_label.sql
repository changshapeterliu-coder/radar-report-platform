-- ============================================================
-- 026c_persist_weekly_topic_rankings_drop_legacy_label.sql
--
-- Step (f) of the 7-step rollout sequence (Req 9.1) — PR-F.
--
-- Re-creates `persist_weekly_topic_rankings` WITHOUT the legacy
-- `topic_label` / `topic_label_zh` dual-write that 026b carries
-- during the rollout window. After this migration is live, the
-- next weekly publish run inserts `topic_rankings` rows that
-- reference the canonical dictionary only via `canonical_topic_key`;
-- the two legacy text columns receive their column default (NULL)
-- and are dead weight until migration 027 (PR-G) drops them.
--
-- Sequencing (Req 9.1):
--   - 025  widens topic_canonicals.origin                   ← PR-A
--   - 026  adds topic_rankings.canonical_topic_key nullable ← PR-B
--   - 026b creates the RPC with dual-write                  ← PR-B
--   - PR-C / PR-D / PR-E ship code + backfill + dashboard read swap
--   - 026c re-creates the RPC WITHOUT dual-write            ← PR-F (this file)
--   - 027  drops the legacy columns + tightens to NOT NULL  ← PR-G
--
-- This migration MUST run BEFORE 027. If 027 lands first, the live
-- 026b function would attempt to INSERT into columns that no longer
-- exist and every publish run would fail. The order is enforced by
-- the file-name sort (026c < 027).
--
-- What changed vs. 026b:
--   - Removed DECLAREd vars: v_canonical_title_zh, v_canonical_title_en,
--     v_topic_label
--   - Removed the SELECT canonical_title_zh, canonical_title_en
--     FROM topic_canonicals lookup inside the per-assignment loop
--   - Removed the COALESCE(NULLIF(TRIM(v_canonical_title_en),''), v_canonical_key)
--     fallback that produced v_topic_label
--   - Removed `topic_label` and `topic_label_zh` from the
--     INSERT INTO topic_rankings column list and VALUES row
--   - COMMENT ON FUNCTION updated to reflect that dual-write is gone
--
-- Everything else (input validation, DELETE-by-report_id, per-module
-- canonical UPSERT, race-safe ON CONFLICT DO NOTHING, bulk seen_count
-- bump, return payload shape, REVOKE/GRANT) is byte-for-byte identical
-- to 026b. Re-runnable: CREATE OR REPLACE + REVOKE/GRANT are idempotent.
--
-- Spec: .kiro/specs/unify-topic-dictionary-across-pipelines/
--   Requirements: 9.1(f), 7.4, 14.3, 15.1, 15.2, 15.3
--   Design:       §"Rollout and Reversibility" — step (f), PR-F
--
-- Depends on:
--   - 026b (function exists and is the version this replaces)
--
-- Manual verification (run in SQL Editor after applying):
--
--   -- 1. Function still exists and is callable.
--   SELECT proname FROM pg_proc WHERE proname = 'persist_weekly_topic_rankings';
--   -- Expected: 1 row.
--
--   -- 2. service_role still has EXECUTE; PUBLIC does not.
--   SELECT has_function_privilege('service_role',
--     'persist_weekly_topic_rankings(UUID, UUID, TEXT, JSONB, JSONB, TEXT[])',
--     'EXECUTE');
--   -- Expected: t.
--   SELECT has_function_privilege('authenticated',
--     'persist_weekly_topic_rankings(UUID, UUID, TEXT, JSONB, JSONB, TEXT[])',
--     'EXECUTE');
--   -- Expected: f.
--
--   -- 3. The function body no longer references topic_label.
--   SELECT pg_get_functiondef(oid) ~ 'topic_label' AS still_references_legacy
--     FROM pg_proc WHERE proname = 'persist_weekly_topic_rankings';
--   -- Expected: f.
--
--   -- 4. Empty-input shape sanity check (no DB writes; the per-module
--   --    loops simply don't iterate). Run inside a transaction you'll
--   --    roll back since it would DELETE topic_rankings for the dummy
--   --    UUID — though there are none, so it's a no-op either way.
--   BEGIN;
--   SELECT persist_weekly_topic_rankings(
--     '00000000-0000-0000-0000-000000000000'::UUID,
--     '00000000-0000-0000-0000-000000000000'::UUID,
--     '2026-W01',
--     '{}'::JSONB,
--     '{}'::JSONB,
--     ARRAY[]::TEXT[]
--   );
--   -- Expected: { "inserted": 0, "perModule": {}, "newCanonicalKeys": [],
--   --            "reusedCanonicalKeys": [] }
--   ROLLBACK;
--
-- Rollback if reverted (run in SQL Editor — restores the 026b body
-- so dual-write resumes):
--
--   -- Re-apply migration 026b verbatim. The file is preserved in
--   -- git and CREATE OR REPLACE is idempotent. After re-applying,
--   -- the function will once again dual-write topic_label /
--   -- topic_label_zh on every publish run.
-- ============================================================

CREATE OR REPLACE FUNCTION persist_weekly_topic_rankings(
  p_report_id UUID,
  p_domain_id UUID,
  p_week_label TEXT,
  p_topics_by_module JSONB,        -- { "0": [ScanTopic, ...], "1": [...] }
  p_assignments_by_module JSONB,   -- { "0": [CanonicalAssignment, ...], "1": [...] }
  p_existing_canonical_keys TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_today                  DATE := (now() AT TIME ZONE 'Asia/Shanghai')::DATE;
  v_existing_set           TEXT[];
  v_new_canonical_keys     TEXT[] := ARRAY[]::TEXT[];
  v_reused_canonical_keys  TEXT[] := ARRAY[]::TEXT[];
  v_reuse_counts           JSONB := '{}'::JSONB;          -- { canonical_key: count_in_this_run }
  v_per_module             JSONB := '{}'::JSONB;          -- { "0": N0, "1": N1 }
  v_inserted_total         INT  := 0;
  v_module_key             TEXT;
  v_topics                 JSONB;
  v_assignments            JSONB;
  v_assignment             JSONB;
  v_topic                  JSONB;
  v_assignments_count      INT;
  v_per_module_count       INT;
  v_inserted_key           TEXT;
  v_keywords_joined        TEXT;
  v_canonical_key          TEXT;
  i                        INT;
BEGIN
  -- ── 1. Validate input shapes ────────────────────────────────
  IF p_topics_by_module IS NULL OR jsonb_typeof(p_topics_by_module) <> 'object' THEN
    RAISE EXCEPTION 'persist_weekly_topic_rankings: p_topics_by_module must be a JSON object';
  END IF;
  IF p_assignments_by_module IS NULL OR jsonb_typeof(p_assignments_by_module) <> 'object' THEN
    RAISE EXCEPTION 'persist_weekly_topic_rankings: p_assignments_by_module must be a JSON object';
  END IF;

  -- Module-key sets must agree across the two payloads.
  IF (SELECT array_agg(t.k ORDER BY t.k) FROM jsonb_object_keys(p_topics_by_module) AS t(k))
     IS DISTINCT FROM
     (SELECT array_agg(t.k ORDER BY t.k) FROM jsonb_object_keys(p_assignments_by_module) AS t(k))
  THEN
    RAISE EXCEPTION 'persist_weekly_topic_rankings: module-key mismatch between p_topics_by_module and p_assignments_by_module';
  END IF;

  -- Per-module array length parity (one assignment per scanned topic).
  FOR v_module_key IN SELECT jsonb_object_keys(p_topics_by_module) LOOP
    IF jsonb_array_length(p_topics_by_module -> v_module_key)
       <> jsonb_array_length(p_assignments_by_module -> v_module_key)
    THEN
      RAISE EXCEPTION 'persist_weekly_topic_rankings: module % length mismatch (topics=% assignments=%)',
        v_module_key,
        jsonb_array_length(p_topics_by_module -> v_module_key),
        jsonb_array_length(p_assignments_by_module -> v_module_key);
    END IF;
  END LOOP;

  v_existing_set := COALESCE(p_existing_canonical_keys, ARRAY[]::TEXT[]);

  -- ── 2. Wipe prior topic_rankings rows for this report (Req 7.4) ─
  DELETE FROM topic_rankings WHERE report_id = p_report_id;

  -- ── 3. Per-module canonical upserts + reuse-count tally ─────
  FOR v_module_key IN SELECT jsonb_object_keys(p_assignments_by_module) LOOP
    v_assignments       := p_assignments_by_module -> v_module_key;
    v_assignments_count := jsonb_array_length(v_assignments);

    FOR i IN 0 .. v_assignments_count - 1 LOOP
      v_assignment := v_assignments -> i;

      -- Drops never produce a topic_rankings row and never touch the dictionary.
      CONTINUE WHEN (v_assignment ->> 'decision') = 'drop';

      v_canonical_key := v_assignment ->> 'canonical_topic_key';

      -- Mint a brand-new canonical when the engine flagged it AND it's not in
      -- the caller-supplied existing-key snapshot. ON CONFLICT (domain_id,
      -- canonical_topic_key) DO NOTHING handles the race where a concurrent
      -- run minted the same key first (Req 6.2, 6.3, 15.3) — RETURNING is
      -- NULL on race-loss and we fall through to the reuse branch.
      IF (v_assignment ->> 'is_new_canonical')::BOOLEAN = true
         AND NOT (v_canonical_key = ANY(v_existing_set))
      THEN
        INSERT INTO topic_canonicals (
          domain_id,
          canonical_topic_key,
          canonical_title_zh,
          canonical_description_zh,
          category_slug,
          secondary_axis_type,
          secondary_axis_value,
          first_seen_date,
          last_seen_date,
          seen_count,
          origin
        )
        VALUES (
          p_domain_id,
          v_canonical_key,
          v_assignment ->> 'canonical_title_zh',
          v_assignment ->> 'canonical_description_zh',
          v_assignment ->> 'category_slug',
          v_assignment ->> 'secondary_axis_type',
          v_assignment ->> 'secondary_axis_value',
          v_today,
          v_today,
          1,
          'weekly_report'                                   -- Req 2.3
        )
        ON CONFLICT (domain_id, canonical_topic_key) DO NOTHING
        RETURNING canonical_topic_key INTO v_inserted_key;

        IF v_inserted_key IS NOT NULL THEN
          v_new_canonical_keys := array_append(v_new_canonical_keys, v_inserted_key);
        END IF;
      END IF;

      -- Tally reuse count per key (used by the bulk UPDATE below). Includes
      -- both freshly-minted keys (so seen_count moves from 1 → reuse_count)
      -- and pre-existing keys.
      v_reuse_counts := jsonb_set(
        v_reuse_counts,
        ARRAY[v_canonical_key],
        to_jsonb(
          COALESCE((v_reuse_counts ->> v_canonical_key)::INT, 0) + 1
        )
      );
    END LOOP;
  END LOOP;

  -- ── 4. Bulk-update last_seen_date + seen_count for every canonical seen ─
  -- For minted-this-run keys: seen_count was inserted at 1, so add (reuse_count - 1).
  -- For pre-existing or race-loser keys: seen_count grows by reuse_count.
  UPDATE topic_canonicals tc
     SET last_seen_date = v_today,
         seen_count = tc.seen_count
                    + CASE
                        WHEN tc.canonical_topic_key = ANY(v_new_canonical_keys)
                          THEN GREATEST(((v_reuse_counts ->> tc.canonical_topic_key)::INT) - 1, 0)
                        ELSE COALESCE((v_reuse_counts ->> tc.canonical_topic_key)::INT, 0)
                      END,
         updated_at = now()
   WHERE tc.domain_id = p_domain_id
     AND tc.canonical_topic_key IN (SELECT jsonb_object_keys(v_reuse_counts));

  -- Capture reused keys for the return payload (telemetry only).
  SELECT COALESCE(array_agg(t.k), ARRAY[]::TEXT[])
    INTO v_reused_canonical_keys
    FROM jsonb_object_keys(v_reuse_counts) AS t(k)
   WHERE NOT (t.k = ANY(v_new_canonical_keys));

  -- ── 5. INSERT topic_rankings for every kept assignment ──────
  -- PR-F: legacy topic_label / topic_label_zh dual-write removed. Readers
  -- must resolve display labels via the (domain_id, canonical_topic_key)
  -- composite FK into topic_canonicals (canonical_title_zh / _en).
  FOR v_module_key IN SELECT jsonb_object_keys(p_assignments_by_module) LOOP
    v_topics            := p_topics_by_module -> v_module_key;
    v_assignments       := p_assignments_by_module -> v_module_key;
    v_assignments_count := jsonb_array_length(v_assignments);
    v_per_module_count  := 0;

    FOR i IN 0 .. v_assignments_count - 1 LOOP
      v_assignment := v_assignments -> i;
      CONTINUE WHEN (v_assignment ->> 'decision') = 'drop';

      v_canonical_key := v_assignment ->> 'canonical_topic_key';
      v_topic         := v_topics -> ((v_assignment ->> 'scanned_topic_index')::INT);

      -- raw_keywords: '/'-joined keyword list, matching the legacy extract.ts
      -- convention so any reader that didn't migrate to JSONB still parses.
      SELECT string_agg(kw.value, '/')
        INTO v_keywords_joined
        FROM jsonb_array_elements_text(COALESCE(v_topic -> 'keywords', '[]'::JSONB)) AS kw(value);

      INSERT INTO topic_rankings (
        report_id,
        domain_id,
        module_index,
        canonical_topic_key,
        rank,
        week_label,
        raw_reason,
        raw_keywords
      )
      VALUES (
        p_report_id,
        p_domain_id,
        (v_module_key)::INT,
        v_canonical_key,
        COALESCE((v_topic ->> 'rank')::INT, i + 1),
        p_week_label,
        v_topic ->> 'summary_zh',
        v_keywords_joined
      );

      v_inserted_total   := v_inserted_total + 1;
      v_per_module_count := v_per_module_count + 1;
    END LOOP;

    v_per_module := jsonb_set(v_per_module, ARRAY[v_module_key], to_jsonb(v_per_module_count));
  END LOOP;

  RETURN jsonb_build_object(
    'inserted',            v_inserted_total,
    'perModule',           v_per_module,
    'newCanonicalKeys',    to_jsonb(v_new_canonical_keys),
    'reusedCanonicalKeys', to_jsonb(v_reused_canonical_keys)
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'persist_weekly_topic_rankings failed: %', SQLERRM
    USING HINT = 'The transaction has rolled back. No topic_rankings or topic_canonicals changes persisted.';
END;
$fn$;

-- Lock the function down to service_role only. Same grant policy as 026b —
-- restated here because CREATE OR REPLACE FUNCTION does not reset grants
-- but a fresh deploy environment running 026c first (without 026b) would
-- otherwise have no explicit grant.
REVOKE ALL ON FUNCTION persist_weekly_topic_rankings(UUID, UUID, TEXT, JSONB, JSONB, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION persist_weekly_topic_rankings(UUID, UUID, TEXT, JSONB, JSONB, TEXT[]) TO service_role;

COMMENT ON FUNCTION persist_weekly_topic_rankings(UUID, UUID, TEXT, JSONB, JSONB, TEXT[]) IS
  'Atomic persistence for the weekly publish topic-rankings flow. Legacy '
  'topic_label / topic_label_zh dual-write removed in PR-F (migration 026c) — '
  'readers resolve display labels via the (domain_id, canonical_topic_key) '
  'composite FK into topic_canonicals. Single transaction: DELETE prior '
  'topic_rankings for the report, UPSERT new topic_canonicals '
  '(origin=''weekly_report''), bump seen_count and last_seen_date for every '
  'referenced canonical, INSERT new topic_rankings rows. Any error rolls '
  'back the whole transaction (Req 14.3 / 15.2). Returns { inserted, '
  'perModule, newCanonicalKeys, reusedCanonicalKeys }. Spec: '
  'unify-topic-dictionary-across-pipelines, Req 2.3 / 2.4 / 6.2 / 6.3 / '
  '7.4 / 9.1(f) / 14.3 / 15.1-15.3. Migration 027 (PR-G) drops the now-'
  'unused topic_label / topic_label_zh columns and tightens '
  'canonical_topic_key to NOT NULL.';
