# Implementation Plan — Prompt Recency + Persona Alignment

## Overview

Fix two drifts surfaced after 2026-05-02 GLM swap: Stage 2 deep-dive引用过时内容 (Symptom A) + 3 个 DB prompt 的 persona 与真实模型不一致 (Symptom B). Single commit, single migration.

## Tasks

- [x] 1. Update `loop.ts` — tighten GLM Stage 2 recency
  - [x] 1.1 Change `searchRecency: 'oneMonth'` → `searchRecency: 'oneWeek'` in the `p.stage === 'deep-dive'` branch of `callResearcher`
  - [x] 1.2 Run `getDiagnostics` on `src/lib/research-engine/engines/loop.ts` — zero errors
  - _Source: design §5_

- [x] 2. Rewrite `supabase/migrations/013_align_engine_personas.sql` to merge persona fixes + time-layering block
  - [x] 2.1 Replace the existing 013 migration (created earlier as persona-only) with a combined version that also appends the shared "时间分层约束" block to `engine_a_hot_radar`, `engine_b_hot_radar`, and `shared_deep_dive` prompts
  - [x] 2.2 Inside the new `engine_a_hot_radar` prompt text: self-identification 改为 "Moonshot Kimi K2-0906 via $web_search", 相对优势/盲区段按 design §4 重写, 插入时间分层段在强制搜索指令之后、反幻觉规则之前
  - [x] 2.3 Inside the new `engine_b_hot_radar` prompt text: self-identification 改为 "Zhipu GLM-4.6 via z.ai web_search", 相对优势/盲区段按 design §4 重写, 插入时间分层段在相同位置
  - [x] 2.4 Inside the new `shared_deep_dive` prompt text: 插入时间分层段在前置"输入"段之后、具体"任务规则"之前（此 prompt 无 self-identification 需要改）
  - [x] 2.5 Inside the new `synthesizer_prompt` text: 只修 self-identification 句子（"A 用 Moonshot Kimi K2-0906，B 用 Zhipu GLM-4.6"），不加时间约束（synthesizer 不接触原始搜索）
  - [x] 2.6 Migration 文件顶部 header 注释改为描述 dual-purpose（persona alignment + time-layering）
  - _Source: design §3, §4_

- [x] 3. Full build + test suite verification
  - [x] 3.1 Run `npm run build` — zero TypeScript errors
  - [x] 3.2 Run `npx vitest run src/lib/research-engine/` — expect 16/16 pass (Moonshot 7, zai 10; no new tests needed for this spec)
  - [x] 3.3 Run `git diff --stat` — expect exactly 2 files changed: `src/lib/research-engine/engines/loop.ts` + `supabase/migrations/013_align_engine_personas.sql`, plus new spec directory `.kiro/specs/prompt-recency-and-persona-alignment/`
  - _Source: design §8_

- [x] 4. Commit
  - [x] 4.1 `git add -A`
  - [x] 4.2 Commit with message:
    ```
    Tighten Stage 2 recency + align prompt personas with running models

    - loop.ts: GLM Stage 2 searchRecency 'oneMonth' -> 'oneWeek'
    - Migration 013: align 3 DB prompts (engine_a/b/synthesizer) with
      actual models (Moonshot K2-0906 + Zhipu GLM-4.6); add shared
      "时间分层约束" block to all 3 Stage prompts
    - Spec: .kiro/specs/prompt-recency-and-persona-alignment/

    Addresses deep-dive outdated quote issue + post-GLM-swap persona
    drift observed on 2026-05-02. Semantic rule: topics can be long-
    running issues, evidence (quotes / cases / painpoints) must be
    within the coverage window.
    ```
  - _Source: none (mechanical)_

- [x] 5. **Ask user before pushing** (GATE, per git_safety rule)
  - [x] 5.1 Use `userInput` tool to ask "Build green, tests 16/16, 2-file scope confirmed. Push to origin/main now?"
  - [x] 5.2 Wait for explicit confirmation
  - _Source: safety_guardrails_

- [x] 6. Push
  - [x] 6.1 `git push origin main`
  - [x] 6.2 `git log origin/main -1 --oneline` confirm
  - [x] 6.3 Tell user to wait for Vercel Ready + Current
  - _Source: none (mechanical)_

- [x] 7. User applies migration 013 in Supabase SQL Editor
  - [x] 7.1 (user action) Open Supabase SQL Editor, paste contents of `supabase/migrations/013_align_engine_personas.sql`, execute
  - [x] 7.2 (user action) Run the verification SQL from design §8:
    ```sql
    SELECT prompt_type, substring(template_text, 1, 300) AS preview, updated_at
    FROM prompt_templates
    WHERE prompt_type IN ('engine_a_hot_radar', 'engine_b_hot_radar', 'synthesizer_prompt')
    ORDER BY prompt_type;
    ```
    Confirm: Engine A preview starts with "Moonshot Kimi K2-0906", Engine B with "Zhipu GLM-4.6", synthesizer mentions both correctly. `updated_at` is current timestamp.
  - [x] 7.3 (user action) Paste verification SQL result into chat
  - _Source: design §8_

- [x] 8. Vercel Ready + Current confirmation
  - [x] 8.1 (user action) Open Vercel Deployments, confirm new commit is Ready AND Current
  - [x] 8.2 (user action) Confirm in chat
  - _Source: verification-before-completion.md_

- [-] 9. Trigger a verification run + inspect new draft
  - [ ] 9.1 (user action) In Supabase SQL Editor: `DELETE FROM scheduled_runs WHERE status IN ('queued', 'running');`
  - [ ] 9.2 (user action) Click "Trigger now" on `/admin/scheduled-runs`
  - [ ] 9.3 (user action) Wait 5-10 minutes for Inngest run to complete
  - [ ] 9.4 (user action) Open the newest draft in `/reports/[id]`
  - [ ] 9.5 (user action) For 3 random QUOTE blocks in Module 1/2 deep-dives, inspect the source text and confirm it's from sellers within the coverage window (04-26 ~ 05-02 at time of writing, or whatever the current window is)
  - [ ] 9.6 (user action) Confirm any policy background paragraphs are prefixed with "背景说明" or "政策参考" labels
  - [ ] 9.7 (user action) Report results in chat
  - _Source: bugfix.md §8_

- [ ] 10. Close spec — acceptance criteria check
  - Only close when all of these are green:
    - ✓ `npm run build` zero errors
    - ✓ Tests 16/16 pass
    - ✓ 2-file + new spec dir diff scope
    - ✓ Migration 013 successfully applied in Supabase
    - ✓ 3 prompts' preview strings updated correctly (task 7.2)
    - ✓ New verification run shows quotes within coverage window (task 9.5)
    - ✓ Historical materials clearly labeled as "背景" / "政策参考" (task 9.6)
  - Produce done message per verification-before-completion.md template
  - _Source: bugfix.md §8_
