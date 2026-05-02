# Design Document — Prompt Recency + Persona Alignment

## 1. Summary

Two-file-change bugfix that closes two drifts caught after the 2026-05-02 GLM swap:

1. **API level** — tighten GLM's Stage 2 `search_recency_filter` from `'oneMonth'` to `'oneWeek'`
2. **Prompt level** — append a shared "时间分层约束" block to all three DB-editable Stage prompts; simultaneously fix the persona self-identification sentences to match the currently running models

One code file, one new SQL migration. No schema changes, no type changes.

## 2. Why not post-process filtering?

Considered and rejected (see bugfix.md §6). Would need `EngineSearchReference.published_date` to become reliable (currently provider-dependent and often absent), plus a new filter step in `normalizeDeepDive`. Cost > benefit when prompt + API-level constraints can do 80% of the work.

Principle 2 ordering was honored: **API constraint first (recency filter), then prompt constraint** — not prompt only.

## 3. The shared "时间分层约束" block

Single authoritative version, copy-pasted verbatim into all three Stage prompts so behavior is uniform across Stage 1 and Stage 2:

```
# 时间分层约束

"雷达"探测的是**本周热度**，不是**本周首发**。Topic 本身可以是
长期议题（欧盟免税、关联封号、KYC 政策、FBA 规则等），入选
条件是"本周在卖家社区有讨论热度"。

但 narrative 里每一条具体证据必须按层分开：

- **卖家痛点描述**（seller_discussion、painpoints、quotes、
  narrative 中"本周卖家说什么"的段落、被讨论的 cases、量化
  观察）→ 必须来自 {start_date} 至 {end_date} 窗口内的卖家
  公开讨论
- **政策背景 / 法规原文 / 平台规则**（用来帮助读者理解 topic
  上下文）→ 可以是历史的，但必须清楚标注"背景说明"或"政策
  参考"，不能当成本周动态呈现

判断一条内容该用哪个时窗的 litmus test：
> 这条是在回答"**本周**卖家有多痛 / 多吵 / 多慌"吗？
> 是 → 必须窗口内
> 否（是在回答"这事是什么 / 为什么会发生"）→ 可以历史，但标注
```

### Why verbatim (not paraphrased) across prompts

- 一致性信号对 AI 更稳：措辞 token 级别相同，LLM 不会对"好像是又好像不是同一条规则"犹豫
- 用户未来调整时只需改一次措辞然后复制三处（migration 014+ 可以解耦，但现在 3 份复制成本可接受）
- 不同 prompt 的其他部分（搜索指令、schema）是各自独特的，时间约束作为"总则"独立一段最清楚

### Where it goes in each prompt

- `engine_a_hot_radar`: 放在"强制搜索指令"段之后、"反幻觉规则"段之前（它在语义上是介于"搜什么"和"别编什么"之间的约束）
- `engine_b_hot_radar`: 同上
- `shared_deep_dive`: 放在前置的"输入"段之后、具体"任务规则"之前

## 4. Persona correction (Symptom B)

The exact strings to put in each prompt's self-identification line:

| Prompt | New identity sentence |
|---|---|
| `engine_a_hot_radar` | 你是 Engine A —— 由 **Moonshot Kimi K2-0906** 驱动的中文跨境电商情报研究员，接入 Moonshot 原生 **`$web_search` 搜索工具** |
| `engine_b_hot_radar` | 你是 Engine B —— 由 **Zhipu GLM-4.6** 驱动的中文跨境电商情报研究员，接入 z.ai 原生 **`web_search` 搜索工具** |
| `synthesizer_prompt` | 两个独立 engine（**A 用 Moonshot Kimi K2-0906，B 用 Zhipu GLM-4.6**）各自完成了 4 stage |

Each engine's "相对优势 / 相对盲区" paragraphs also rewritten to match the actual model's documented strengths. See migration SQL for the final wording.

## 5. API-level recency change

### Current state (`loop.ts`)

```typescript
} else if (p.stage === 'deep-dive') {
  searchRecency = 'oneMonth';
  contentSize = 'high';
}
```

### New state

```typescript
} else if (p.stage === 'deep-dive') {
  searchRecency = 'oneWeek';
  contentSize = 'high';
}
```

Only the `searchRecency` value changes. `contentSize = 'high'` kept — narrative depth still needs rich source text.

### Why `oneWeek` not `oneDay`

Coverage window is usually 7-14 days. `oneWeek` aligns with the window; `oneDay` would artificially exclude mid-window findings (e.g. 4 days ago).

### Why not apply recency to Stage 1

Stage 1 already uses `oneWeek`. Unchanged.

## 6. File-level diff map

| File | Change type | Details |
|---|---|---|
| `src/lib/research-engine/engines/loop.ts` | MODIFY | Stage 2 `searchRecency: 'oneMonth' → 'oneWeek'` (1-line change) |
| `supabase/migrations/013_align_engine_personas.sql` | REPLACE | Already exists as persona-only migration; rewrite to include the time-layering block + persona fixes in one migration. (Migration file not yet applied in prod; safe to modify in place) |
| `.kiro/specs/prompt-recency-and-persona-alignment/*` | CREATE | Spec artifact (this directory) |

No other files touched. No schema changes. No type changes.

## 7. Rollback plan

### Tier 1 — revert code + re-apply old prompts

1. `git revert <commit-sha>` → push → Vercel auto-redeploys previous `loop.ts`
2. Re-run `011b_fix_hot_radar_lazy_path.sql` and `012_markdown_hybrid_synthesizer.sql` manually in Supabase SQL Editor (both are idempotent UPDATE blocks)
3. 3 prompts return to previous wording; `searchRecency` returns to `'oneMonth'`

Timing: ~2 min code revert + ~30 sec SQL re-run

### Tier 2 — only partial rollback

If only the prompt changes cause issues but the recency tightening is good:
- Keep code commit, only re-run 011b + 012 migrations → prompt reverts, `loop.ts` stays on `'oneWeek'`

If only the recency is too aggressive:
- Keep prompts, manually `UPDATE` a new migration that sets recency back to `'oneMonth'` in code — but actually simpler to revert the `loop.ts` line via a follow-up commit

## 8. Verification plan

See bugfix.md §8 acceptance criteria.

Post-deploy verification SQL:

```sql
-- Confirm the 3 prompts were updated
SELECT prompt_type, substring(template_text, 1, 300) AS preview, updated_at
FROM prompt_templates
WHERE prompt_type IN ('engine_a_hot_radar', 'engine_b_hot_radar', 'synthesizer_prompt')
ORDER BY prompt_type;
```

Expected: preview for Engine A starts with "Moonshot Kimi K2-0906"; Engine B with "Zhipu GLM-4.6"; synthesizer mentions "A 用 Moonshot Kimi K2-0906，B 用 Zhipu GLM-4.6".

### Content-level verification (after next trigger)

1. Open `/reports/[id]` for the newest draft
2. For 3 random quotes in Module 1 / 2 deep-dives, check the QUOTE source text — should be from sellers in the 04-26 ~ 05-02 window
3. Confirm any policy background paragraph is clearly prefixed with "背景说明" or "政策参考"

## 9. Known risks

| Risk | Mitigation |
|---|---|
| Moonshot prompt-only recency may be violated | Accepted limitation (Moonshot API has no recency knob). Litmus test in prompt is our best mitigation. Monitor in subsequent runs. |
| `oneWeek` too narrow for topics needing 2-week context | `contentSize: 'high'` still in place; rich snippets mitigate. Fall back to `'oneMonth'` is a 1-line follow-up if observed. |
| AI over-indexes on "必须在窗口内" and drops good historical context | The "但 topic 必须在本周有明确讨论热度" balance clause keeps topic breadth. |
| Prompt token count grows ~100 tokens per prompt | Negligible vs 8192 max_tokens budget. |

## 10. No property-based tests

Prompt changes are text edits; behavior changes are LLM-mediated and not unit-testable. Verification is live-run + content inspection. This is consistent with engine-b-glm-replacement spec's testing stance.
