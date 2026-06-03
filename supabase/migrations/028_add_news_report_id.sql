-- ============================================================
-- 028_add_news_report_id.sql
--
-- Adds an ownership link from `news` back to the `reports` row that
-- produced it, so a report's AI Insight news (source_channel =
-- 'AI Insight') becomes a Derived_Artifact the report OWNS — mirroring
-- the ownership `topic_rankings` already has via its report_id FK.
--
-- Two behaviors this column unlocks (both in the publish route, not here):
--   - Idempotent re-publish (R9.1): the publish route can DELETE this
--     report's prior AI Insight news WHERE report_id = id BEFORE
--     re-generating, so re-publish REPLACES instead of appending —
--     parallel to persist_weekly_topic_rankings'
--     DELETE-by-report_id-then-insert pattern.
--   - Cascade delete (R9.2): ON DELETE CASCADE removes a report's AI
--     Insight news automatically when the report is deleted. The cascade
--     is enforced by the DB engine, so it fires even though
--     DELETE /api/reports/[id] runs through the user-scoped (RLS) client
--     — RLS does not gate FK cascades.
--
-- The column is NULLABLE on purpose: human-authored / curated news
-- (POST /api/news) has no originating report and leaves report_id NULL.
-- Only the publish route's AI Insight inserts set it.
--
-- Spec: .kiro/specs/smart-paste-topic-extraction/
--   Requirements: 9.2, 9.3
--   Design:       §"Data Models / news.report_id"
--
-- Depends on:
--   - 001 (news + reports tables exist)
--
-- Re-run safety:
--   - ADD COLUMN IF NOT EXISTS
--   - DO-block guard around ADD CONSTRAINT (PG has no ADD CONSTRAINT IF NOT EXISTS)
--   - CREATE INDEX IF NOT EXISTS
--
-- Manual verification (run in SQL Editor after applying):
--
--   SELECT column_name, is_nullable, data_type
--     FROM information_schema.columns
--    WHERE table_name = 'news'
--      AND column_name = 'report_id';
--   -- Expected: 1 row, is_nullable='YES', data_type='uuid'.
--
--   SELECT conname, confdeltype FROM pg_constraint
--    WHERE conrelid = 'public.news'::regclass
--      AND conname = 'news_report_id_fkey';
--   -- Expected: 1 row, confdeltype='c' (CASCADE).
--
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'news'
--      AND indexname = 'idx_news_report_id';
--   -- Expected: 1 row.
--
-- Rollback if reverted (run in SQL Editor):
--
--   DROP INDEX IF EXISTS public.idx_news_report_id;
--   ALTER TABLE public.news
--     DROP CONSTRAINT IF EXISTS news_report_id_fkey;
--   ALTER TABLE public.news
--     DROP COLUMN IF EXISTS report_id;
--
--   -- Dropping report_id loses the ownership link only; no news row
--   -- content is destroyed. A full revert also requires git-reverting
--   -- the publish-route change (PR task 7.1) that sets report_id and
--   -- does the DELETE-by-report_id replace, otherwise the route would
--   -- reference a column that no longer exists.
-- ============================================================

-- 1. Add the nullable ownership column.
ALTER TABLE public.news
  ADD COLUMN IF NOT EXISTS report_id UUID NULL;

-- 2. Add the FK into reports with ON DELETE CASCADE.
--    PG has no `ADD CONSTRAINT IF NOT EXISTS`, so guard explicitly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'news_report_id_fkey'
       AND conrelid = 'public.news'::regclass
  ) THEN
    ALTER TABLE public.news
      ADD CONSTRAINT news_report_id_fkey
      FOREIGN KEY (report_id)
      REFERENCES public.reports (id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- 3. Supporting index for the R9.1 DELETE-by-report_id replace lookup
--    and the FK cascade.
CREATE INDEX IF NOT EXISTS idx_news_report_id
  ON public.news (report_id);

-- 4. Document the column.
COMMENT ON COLUMN public.news.report_id IS
  'Ownership link to the reports row that produced this news item. '
  'NULL for human-authored / curated news (POST /api/news); set only by '
  'the publish route for AI Insight rows (source_channel=''AI Insight''). '
  'ON DELETE CASCADE makes a report own its AI Insight news (R9.2); the '
  'index supports the idempotent DELETE-by-report_id replace on re-publish '
  '(R9.1). Spec: smart-paste-topic-extraction, Req 9.2 / 9.3.';
