-- ============================================================
-- 009_scheduled_runs_rls.sql
-- Row Level Security for schedule_configs, prompt_templates,
-- scheduled_runs. All three tables: admin full access, team_member
-- zero access. Server-side code that uses the service role key
-- bypasses RLS entirely (Inngest functions writing runs / notifications).
-- ============================================================

ALTER TABLE schedule_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to schedule_configs"
  ON schedule_configs FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

ALTER TABLE prompt_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to prompt_templates"
  ON prompt_templates FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

ALTER TABLE scheduled_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to scheduled_runs"
  ON scheduled_runs FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
