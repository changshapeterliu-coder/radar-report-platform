-- ============================================================
-- 006_create_schedule_configs.sql
-- Create schedule_configs table for the scheduled regular report
-- generation feature. Exactly one row per domain.
-- ============================================================

CREATE TABLE schedule_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID NOT NULL UNIQUE REFERENCES domains(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  cadence TEXT NOT NULL DEFAULT 'biweekly'
    CHECK (cadence IN ('weekly', 'biweekly')),
  day_of_week TEXT NOT NULL DEFAULT 'monday'
    CHECK (day_of_week IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  time_of_day VARCHAR(5) NOT NULL DEFAULT '09:00'
    CHECK (time_of_day ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'),
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  report_type TEXT NOT NULL DEFAULT 'regular'
    CHECK (report_type IN ('regular', 'topic')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
