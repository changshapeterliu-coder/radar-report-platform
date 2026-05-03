# Implementation Plan — Goal-Oriented Prompt Rewrite (v5)

## Overview

Rewrite 4 DB-editable prompts (engine_a_hot_radar, engine_b_hot_radar,
shared_deep_dive, synthesizer_prompt) per Anthropic context engineering
framework. Single migration 014. No code changes.

## Tasks

- [x] 1. Create migration 014 with all 4 prompts rewritten
  - [x] 1.1 Create `supabase/migrations/014_goal_oriented_prompt_rewrite.sql` with idempotent `DO $do$...$do$` block
  - [x] 1.2 Write v_engine_a_stage1 in goal-oriented style per design §4 principles (role + mission + search strategy as goal, not recipe; A/B category with honest quota "目标 Top 5 但不凑数")
  - [x] 1.3 Write v_engine_b_stage1 mirroring A with GLM-specific role description
  - [x] 1.4 Write v_shared_deep_dive with explicit "信任 Stage 1 handoff" section + A/B/C field layering + forbidden narrative phrases
  - [x] 1.5 Write v_synthesizer keeping original merge algorithm but cleaning up "三个最高优先级" contradiction
  - [x] 1.6 Include 4 final UPDATE statements applying the new prompts by `prompt_type`
  - _Source: design §4, §5_

- [x] 2. Self-verify migration 014 content
  - [x] 2.1 grep migration for remnants of removed patterns: "至少 2-3 次", "必须至少 3 条", "至少 3 条" — expect zero matches in new prompt text (only allowed in header comments describing the change)
  - [x] 2.2 grep migration for new handoff clause: "信任 Stage 1" or equivalent — expect match in shared_deep_dive section
  - [x] 2.3 grep migration for "最高优先级" — expect exactly 1 occurrence (synthesizer's "反幻觉" block), not 3
  - _Source: design §8 Gate 1_

- [x] 3. Update previous spec's status (housekeeping)
  - [x] 3.1 Mark `.kiro/specs/prompt-recency-and-persona-alignment/tasks.md` Task 9-10 as completed (its verification run found regression, which triggered this new spec; closing the loop explicitly)
  - _Source: housekeeping_

- [x] 4. Build + test verification
  - [x] 4.1 `npm run build` — zero TypeScript errors (no code changes so should trivially pass)
  - [x] 4.2 `npx vitest run src/lib/research-engine/` — expect 17/17 pass
  - [x] 4.3 `git diff --stat` — expect 1 new migration + new spec dir + updated spec tasks.md
  - _Source: design §8 Gate 1_

- [-] 5. Commit
  - [ ] 5.1 `git add -A`
  - [ ] 5.2 Commit with message:
    ```
    Rewrite 4 prompts goal-oriented (Anthropic context engineering)

    - Migration 014: rewrites engine_a_hot_radar, engine_b_hot_radar,
      shared_deep_dive, synthesizer_prompt in role-driven, goal-oriented
      style. Removes hardcoded brittle rules: "至少 2-3 次搜索", 
      "必须至少 3 条 topic", "搜不到就留空" over-broad clause.
    - Stage 2 now explicitly trusts Stage 1's initial_evidence handoff
      and uses A/B/C field layering (narrative必填 / quotes可空 / meta).
    - Spec: .kiro/specs/goal-oriented-prompt-rewrite/

    Addresses 2026-05-02 post-migration-013 regression where 6/10 
    topics came back as "无本周数据" empty shells despite Stage 1 
    reporting strong signals. Root cause was prompt over-prescription;
    fix applies Anthropic "right altitude" + "sub-agent handoff" + 
    "minimal high-signal tokens" principles.
    ```
  - _Source: none (mechanical)_

- [ ] 6. Push gate (ask user before pushing)
  - [ ] 6.1 Use `userInput` to ask "Ready to push migration 014 to origin/main?"
  - [ ] 6.2 Wait for explicit confirmation
  - _Source: git_safety rule_

- [ ] 7. Push
  - [ ] 7.1 `git push origin main`
  - [ ] 7.2 Confirm on remote
  - _Source: none (mechanical)_

- [ ] 8. User applies migration 014 in Supabase SQL Editor
  - [ ] 8.1 (user action) Paste `supabase/migrations/014_goal_oriented_prompt_rewrite.sql` into SQL Editor and run
  - [ ] 8.2 (user action) Run verification SQL from design §8 Gate 2, paste result in chat
  - _Source: design §8 Gate 2_

- [ ] 9. Behavioral verification — run 1 of 2
  - [ ] 9.1 (user action) DELETE stale queued/running rows; Trigger manual run; wait 5-10 min
  - [ ] 9.2 (user action) Open `/reports/[id]` newest draft, manually count:
    - Module 1+2 topics with narrative >100 chars
    - Topics with forbidden phrases "本周无数据" / "本周窗口期内未找到" / etc.
    - Sample 2-3 quotes — are sources within coverage window?
  - [ ] 9.3 (user action) Paste findings in chat
  - _Source: design §8 Gate 3_

- [ ] 10. Behavioral verification — run 2 of 2
  - Same as Task 9. Second run to reduce LLM variance as single-sample risk
  - _Source: design §8 Gate 3, Anthropic "evidence over claims"_

- [ ] 11. Final judgment
  - If both runs show substantial narrative content in ≥8 of 10 topics, 0 forbidden phrases → **spec complete**.
  - If run 1 passes but run 2 fails → acceptable LLM variance; keep.
  - If both runs fail → **rollback**: re-run migration 013 SQL in SQL Editor (idempotent, reverts prompts). Do not revert code.
  - _Source: design §8 Gate 3_
