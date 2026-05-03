-- ============================================================
-- 018_seed_daily_alert_defaults.sql
--
-- Seed one default daily_alert_configs row for the Account Health domain.
-- Ships disabled — admins opt in explicitly via /admin/daily-alert-settings.
--
-- Spec: .kiro/specs/daily-hot-topic-alert/
--   Requirement: 1.8 (default config: enabled=false, time_of_day='06:00')
--   Design:      §Deployment & Operational Checklist §功能开关
--
-- Depends on:
--   - 005 (Account Health domain seeded)
--   - 015 (daily_alert_configs table exists)
--
-- Re-run safety: ON CONFLICT (domain_id) DO NOTHING guarantees idempotent
-- re-run and preserves any admin-edited config values on repeat execution.
-- ============================================================

INSERT INTO daily_alert_configs (domain_id, enabled, time_of_day, timezone)
SELECT id, false, '06:00', 'Asia/Shanghai'
  FROM domains
 WHERE name = 'Account Health'
ON CONFLICT (domain_id) DO NOTHING;


-- ============================================================
-- Manual verification (run after applying migration 018):
--
--   SELECT enabled, time_of_day, timezone
--     FROM daily_alert_configs
--    WHERE domain_id = (SELECT id FROM domains WHERE name = 'Account Health');
--
--   Expected: 1 row, enabled=false, time_of_day='06:00', timezone='Asia/Shanghai'.
-- ============================================================
