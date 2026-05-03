-- ============================================================
-- 016_create_daily_alert_rls.sql
--
-- Enable RLS + attach policies on the 5 tables created by migration 015.
-- Pattern mirrors migration 003 (core platform RLS) + 009 (scheduled_runs).
--
-- Spec: .kiro/specs/daily-hot-topic-alert/
--   Requirements: 1.7, 3.5, 8.1, 11.6, 12.8
--   Design:       §RLS 策略
--
-- Depends on: 015 (tables exist)
--
-- Re-run safety: each policy is preceded by DROP POLICY IF EXISTS because
-- Postgres does NOT support `CREATE POLICY ... IF NOT EXISTS`.
-- ============================================================


-- ====================================================
-- daily_alert_configs — admin only (read and write)
-- ====================================================
ALTER TABLE daily_alert_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to daily_alert_configs" ON daily_alert_configs;
CREATE POLICY "Admins full access to daily_alert_configs"
  ON daily_alert_configs FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );


-- ====================================================
-- daily_alert_runs — admin only (read and write)
-- ====================================================
ALTER TABLE daily_alert_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to daily_alert_runs" ON daily_alert_runs;
CREATE POLICY "Admins full access to daily_alert_runs"
  ON daily_alert_runs FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );


-- ====================================================
-- daily_hot_topic_alerts — authenticated SELECT + admin full
-- ====================================================
ALTER TABLE daily_hot_topic_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view published daily alerts" ON daily_hot_topic_alerts;
CREATE POLICY "Authenticated users can view published daily alerts"
  ON daily_hot_topic_alerts FOR SELECT
  USING (auth.uid() IS NOT NULL AND status = 'published');

DROP POLICY IF EXISTS "Admins can manage daily_hot_topic_alerts" ON daily_hot_topic_alerts;
CREATE POLICY "Admins can manage daily_hot_topic_alerts"
  ON daily_hot_topic_alerts FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );


-- ====================================================
-- daily_hot_topics — authenticated SELECT + admin full
-- ====================================================
ALTER TABLE daily_hot_topics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view daily_hot_topics" ON daily_hot_topics;
CREATE POLICY "Authenticated users can view daily_hot_topics"
  ON daily_hot_topics FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins can manage daily_hot_topics" ON daily_hot_topics;
CREATE POLICY "Admins can manage daily_hot_topics"
  ON daily_hot_topics FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );


-- ====================================================
-- topic_canonicals — authenticated SELECT + admin full
--
-- Positioned for future weekly integration: SELECT is broad (any
-- authenticated user can read the dictionary, which will be consumed by the
-- weekly report UI in a later spec). Writes are admin-only in V1; Inngest
-- writes via service role key, bypassing RLS.
-- ====================================================
ALTER TABLE topic_canonicals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view topic_canonicals" ON topic_canonicals;
CREATE POLICY "Authenticated users can view topic_canonicals"
  ON topic_canonicals FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins can manage topic_canonicals" ON topic_canonicals;
CREATE POLICY "Admins can manage topic_canonicals"
  ON topic_canonicals FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );


-- ============================================================
-- Manual verification (run after applying migration 016):
--
--   SELECT schemaname, tablename, policyname FROM pg_policies
--    WHERE tablename IN ('daily_alert_configs','daily_alert_runs',
--                        'daily_hot_topic_alerts','daily_hot_topics',
--                        'topic_canonicals')
--    ORDER BY tablename, policyname;
--
--   Expected rows (8 total):
--     daily_alert_configs    | Admins full access to daily_alert_configs
--     daily_alert_runs       | Admins full access to daily_alert_runs
--     daily_hot_topic_alerts | Admins can manage daily_hot_topic_alerts
--     daily_hot_topic_alerts | Authenticated users can view published daily alerts
--     daily_hot_topics       | Admins can manage daily_hot_topics
--     daily_hot_topics       | Authenticated users can view daily_hot_topics
--     topic_canonicals       | Admins can manage topic_canonicals
--     topic_canonicals       | Authenticated users can view topic_canonicals
--
--   SELECT tablename, rowsecurity FROM pg_tables
--    WHERE tablename IN ('daily_alert_configs','daily_alert_runs',
--                        'daily_hot_topic_alerts','daily_hot_topics',
--                        'topic_canonicals');
--   Expected: all 5 rows with rowsecurity=true.
-- ============================================================
