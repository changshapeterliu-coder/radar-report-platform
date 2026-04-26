-- ============================================================
-- 007_create_prompt_templates.sql
-- Create prompt_templates table. Three admin-editable prompts per
-- domain: gemini_prompt / kimi_prompt / synthesizer_prompt.
-- System-owned prompts (planner / gap-analyzer / engine-summarizer)
-- live in code at src/lib/research-engine/system-prompts.ts and
-- are intentionally NOT stored here.
-- ============================================================

CREATE TABLE prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  prompt_type TEXT NOT NULL
    CHECK (prompt_type IN ('gemini_prompt', 'kimi_prompt', 'synthesizer_prompt')),
  template_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (domain_id, prompt_type)
);

CREATE INDEX idx_prompt_templates_domain ON prompt_templates(domain_id);
