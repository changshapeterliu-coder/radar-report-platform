-- ============================================================
-- 008_create_scheduled_runs.sql
-- Create scheduled_runs table: execution history for the report
-- generation pipeline. Each row is one run (scheduled or manual).
--
-- Idempotency is enforced via a PARTIAL unique index:
--   Only rows with status IN ('queued','running','succeeded')
--   occupy the unique slot on (domain_id, coverage_window_start).
--   Rows with status IN ('failed','partial') are free — allowing
--   Retry to insert a new run for the same window while keeping
--   the original failure log intact for audit.
-- ============================================================

CREATE TABLE scheduled_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL
    CHECK (trigger_type IN ('scheduled', 'manual')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'partial')),
  coverage_window_start TIMESTAMPTZ NOT NULL,
  coverage_window_end TIMESTAMPTZ NOT NULL,
  week_label VARCHAR(20) NOT NULL,
  draft_report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  failure_reason TEXT,
  gemini_output JSONB,
  kimi_output JSONB,
  synthesizer_output JSONB,
  duration_ms INTEGER,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Partial unique index: failed/partial runs do NOT occupy the slot.
-- Retry inserts a new row; the original failed/partial row is preserved.
CREATE UNIQUE INDEX idx_scheduled_runs_idempotency
  ON scheduled_runs (domain_id, coverage_window_start)
  WHERE status IN ('queued', 'running', 'succeeded');

CREATE INDEX idx_scheduled_runs_domain_triggered
  ON scheduled_runs (domain_id, triggered_at DESC);

CREATE INDEX idx_scheduled_runs_status
  ON scheduled_runs (status);
