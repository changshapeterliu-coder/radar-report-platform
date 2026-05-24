-- ============================================================
-- 026_add_topic_rankings_canonical_topic_key_nullable.sql
--
-- Step (b) of the 7-step rollout sequence (Req 9.1).
--
-- Adds a NULLABLE `canonical_topic_key` column to `topic_rankings`,
-- a composite foreign key into `topic_canonicals (domain_id,
-- canonical_topic_key)`, and a supporting index for the dashboard
-- read-path swap.
--
-- The column is nullable on purpose: between this migration and
-- migration 027, the column is being populated by:
--   - the refactored weekly publish route (PR-C onward) for every
--     new publish, and
--   - the W17/W19 backfill script (PR-D) for the two pre-existing
--     report rows.
-- Migration 027 then sets the column NOT NULL and drops the legacy
-- `topic_label` / `topic_label_zh` columns. Reading code that hits
-- this column during the rollout window MUST handle the NULL case
-- (Req 10.8 transition fallback).
--
-- Spec: .kiro/specs/unify-topic-dictionary-across-pipelines/
--   Requirements: 8.1, 8.2, 8.7, 9.1(b), 9.7
--   Design:       §migration files / §026
--
-- Depends on:
--   - 015 (topic_canonicals exists with UNIQUE (domain_id, canonical_topic_key))
--   - 024 (most recent topic_rankings shape on disk)
--   - 025 (origin CHECK widened — runs first so weekly inserts can land)
--
-- Re-run safety:
--   - ADD COLUMN IF NOT EXISTS
--   - DO-block guard around ADD CONSTRAINT (no IF NOT EXISTS in PG syntax)
--   - CREATE INDEX IF NOT EXISTS
--
-- Manual verification — Req 9.4 (run in SQL Editor after applying):
--
--   SELECT column_name, is_nullable, data_type
--     FROM information_schema.columns
--    WHERE table_name = 'topic_rankings'
--      AND column_name = 'canonical_topic_key';
--   -- Expected: 1 row, is_nullable='YES', data_type='character varying'.
--
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'topic_rankings'::regclass
--      AND conname = 'topic_rankings_canonical_fk';
--   -- Expected: 1 row.
--
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'topic_rankings'
--      AND indexname = 'idx_topic_rankings_domain_canonical';
--   -- Expected: 1 row.
--
-- Rollback if reverted (run in SQL Editor):
--
--   ALTER TABLE public.topic_rankings
--     DROP CONSTRAINT IF EXISTS topic_rankings_canonical_fk;
--   DROP INDEX IF EXISTS public.idx_topic_rankings_domain_canonical;
--   ALTER TABLE public.topic_rankings
--     DROP COLUMN IF EXISTS canonical_topic_key;
-- ============================================================

-- 1. Add the nullable column.
ALTER TABLE public.topic_rankings
  ADD COLUMN IF NOT EXISTS canonical_topic_key VARCHAR(120) NULL;

-- 2. Add the composite foreign key into topic_canonicals.
--    PG has no `ADD CONSTRAINT IF NOT EXISTS`, so guard explicitly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'topic_rankings_canonical_fk'
       AND conrelid = 'public.topic_rankings'::regclass
  ) THEN
    ALTER TABLE public.topic_rankings
      ADD CONSTRAINT topic_rankings_canonical_fk
      FOREIGN KEY (domain_id, canonical_topic_key)
      REFERENCES public.topic_canonicals (domain_id, canonical_topic_key)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- 3. Supporting index for dashboard joins (Req 10.1, 10.4) and for the
--    topic_rankings.canonical_topic_key NOT NULL conversion in 027.
CREATE INDEX IF NOT EXISTS idx_topic_rankings_domain_canonical
  ON public.topic_rankings (domain_id, canonical_topic_key);

-- 4. Document the rollout window on the column.
COMMENT ON COLUMN public.topic_rankings.canonical_topic_key IS
  'Composite FK reference into topic_canonicals via (domain_id, canonical_topic_key). '
  'Nullable during the rollout window (steps b-f of Req 9.1) so existing rows '
  'and rows written before the publish-route refactor lands can coexist with '
  'newly-keyed rows. Migration 027 sets this column NOT NULL after the W17/W19 '
  'backfill confirms zero null values. Spec: unify-topic-dictionary-across-pipelines, Req 8.1, 8.2.';
