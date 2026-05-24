-- ============================================================
-- 025_widen_topic_canonicals_origin.sql
--
-- Widen the CHECK constraint on `topic_canonicals.origin` to accept
-- BOTH 'daily_alert' (existing) AND 'weekly_report' (new). Step (a)
-- of the rollout sequence in Req 9.1 of spec
-- `unify-topic-dictionary-across-pipelines`.
--
-- Why:
-- After this migration, the weekly publish path (PUT /api/reports/[id]/publish)
-- starts inserting rows into `topic_canonicals` with origin='weekly_report'.
-- The original migration 015 narrowed the CHECK to 'daily_alert' only and
-- documented 'weekly_report' as a reserved future value. This migration
-- promotes that future value to active.
--
-- This migration is data-safe:
--  * No existing row is mutated — historical 'daily_alert' rows pass the new
--    CHECK unchanged.
--  * Re-run-safe via DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT.
--
-- Run this in the Supabase Dashboard SQL Editor BEFORE deploying any code
-- that issues INSERT INTO topic_canonicals with origin='weekly_report'
-- (Req 3.2).
--
-- Verification (Req 9.3) — run AFTER apply, expect a definition string that
-- contains BOTH 'daily_alert' AND 'weekly_report':
--
--   SELECT pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'topic_canonicals'::regclass
--     AND conname LIKE '%origin%';
--
-- Rollback (if reverted):
--
--   ALTER TABLE topic_canonicals
--     DROP CONSTRAINT IF EXISTS topic_canonicals_origin_check;
--   ALTER TABLE topic_canonicals
--     ADD CONSTRAINT topic_canonicals_origin_check
--     CHECK (origin IN ('daily_alert'));
--   -- Note: rollback is only safe while no row has origin='weekly_report'.
--   -- If weekly_report rows exist, delete or relabel them first, otherwise
--   -- ADD CONSTRAINT will fail.
-- ============================================================

ALTER TABLE topic_canonicals
  DROP CONSTRAINT IF EXISTS topic_canonicals_origin_check;

ALTER TABLE topic_canonicals
  ADD CONSTRAINT topic_canonicals_origin_check
  CHECK (origin IN ('daily_alert', 'weekly_report'));

COMMENT ON COLUMN topic_canonicals.origin IS
  'Which platform product first created this canonical. Active values: '
  '''daily_alert'' (created by daily-alert pipeline), ''weekly_report'' '
  '(created by weekly publish pipeline). Immutable post-creation. '
  'Both pipelines now share this dictionary '
  '(Spec: unify-topic-dictionary-across-pipelines, Req 3).';
