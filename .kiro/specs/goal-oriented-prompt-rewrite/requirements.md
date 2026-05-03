# Requirements

## User story

**As an** operator of the radar report platform,
**I want** the 4 DB-editable prompts rewritten in goal-oriented, role-driven
style (Anthropic context engineering framework),
**so that** the sub-agent architecture (Stage 1 → Stage 2 → Synthesizer) works
as intended: Stage 1 finds本周 signal, Stage 2 deepens it without re-verifying,
Synthesizer merges cleanly — without the prompt brittleness that broke
2026-05-02 runs.

## Acceptance criteria

Given migration 014 has been applied,
When a scheduled run triggers,
Then:

1. Stage 1 returns honest topic count (≤5 per module, may be as low as 2
   if signal is sparse) without padding with weak signals.
2. Each Stage 1 topic's `initial_evidence` traces to本周 observations.
3. Stage 2 for each Top-3 topic produces:
   - `narrative` field: substantial content (>100 chars), drawing on Stage 1
     signal + web_search補充 + background
   - `painpoints` / `misconception`: substantive, not empty
   - `quotes[]` / `cases[]` / `quantified_observations[]`: populated if
     web_search got本周 verbatim; `[]` otherwise (never fabricated)
4. No `narrative` field contains the forbidden phrases "本周窗口期内未找到",
   "无本周数据", "本周搜索未返回具体案例".
5. Synthesizer merges the two engines' outputs, producing the final
   Markdown-hybrid ReportContent with双印 (✓) correctly marking
   `cross_engine_confirmed=true` topics.
6. Each run's draft is presentable as a weekly report (not an empty-shell).

## Out of scope

- Prompt improvements to Stage 3 (education-mapper) / Stage 4 (assembler) in
  `src/lib/research-engine/system-prompts.ts`.
- Changes to report schema, voice volume formula, module order, rendering
  layer.
- Engine A vs B weighting.
- Switching from weekly to daily cadence.
