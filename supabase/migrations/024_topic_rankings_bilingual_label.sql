-- ============================================================
-- 024_topic_rankings_bilingual_label.sql
-- Add Chinese label column to topic_rankings so the Dashboard
-- trend chart can render the chart legend in the user's UI
-- language (per Principle 3: bilingual content is first-class).
--
-- Existing column `topic_label` stays as the canonical English
-- (cross-week join key). New `topic_label_zh` is the human-facing
-- Chinese rendering, populated by the same LLM pass that minted
-- the English label.
--
-- Backwards compatible: the column is nullable. Older rows
-- inserted before this migration have NULL — the dashboard
-- falls back to `topic_label` (English) for them. Backfill via
-- `npm run backfill:topic-rankings -- --force` to populate the
-- Chinese label for historical rows.
--
-- NOTE: This is also the first migration that touches
-- topic_rankings in version control. The table itself was
-- created out-of-band ages ago (no migration file for the
-- CREATE TABLE existed before this). We do NOT codify the
-- CREATE here because the live shape is correct and we don't
-- want to risk a migration-reset rebuild diverging from prod.
-- If a future migration reset becomes a goal, codify the full
-- schema in a separate squash migration first.
-- ============================================================

ALTER TABLE public.topic_rankings
  ADD COLUMN IF NOT EXISTS topic_label_zh text NULL;

COMMENT ON COLUMN public.topic_rankings.topic_label_zh IS
  'Chinese rendering of topic_label. NULL for rows inserted before migration 024; UI falls back to topic_label (English) when NULL.';
