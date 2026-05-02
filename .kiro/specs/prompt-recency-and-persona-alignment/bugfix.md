# Bug Report: Deep-dive references outdated content + persona drift

## 1. Observed symptoms (C(X) — bug condition)

After the Engine B GLM swap verified on 2026-05-02, two quality issues surfaced in the produced draft:

### Symptom A — Deep-dive引用过时内容

`Stage 2 (deep-dive)` 阶段的 narrative / quotes / cases 里偶尔引用**超出 coverage window 之外的内容**：

- 引语的发布时间早于 `coverage_window.start_date`（例如本周 window 是 04-26 ~ 05-02，但 quote 来自 2025-12 的帖子）
- cases 字段里的事件不是本周在卖家社区被热议的近期事件，而是被 AI 从搜索结果里捞出的旧闻
- 量化观察的数字（"某月封号率上升 30%"）没有绑定到 window 时间，读者误以为是本周新观察

### Symptom B — Prompt persona 与真实模型漂移

3 个 admin-editable prompt（存在 DB `prompt_templates` 表）的自我介绍句与实际生产在跑的模型**不一致**：

| Prompt | Prompt 里写的 | 实际生产模型 |
|---|---|---|
| `engine_a_hot_radar` | "DeepSeek V3.2 via :online" | Moonshot Kimi K2-0906 via `$web_search`（从 2026-05-01 AM 起） |
| `engine_b_hot_radar` | "Moonshot Kimi K2-0905 via :online" | Zhipu GLM-4.6 via z.ai `web_search`（从 2026-05-02 起） |
| `synthesizer_prompt` | "A 用 Moonshot Kimi，B 用 OpenRouter" | "A 用 Moonshot Kimi，B 用 Zhipu GLM-4.6" |

## 2. Reproducer

### Symptom A
1. 触发一次 scheduled run（e.g. `65b8fbba-a537-4515-a99d-4d66c2f285a5`）
2. 查看 `reports/[id]` 页面或 `scheduled_runs.synthesizer_output`
3. 查看任一 topic 的 Markdown body，观察 `> [!QUOTE]` / case 块里的日期
4. 能找到一条以上 quote 的发布时间早于本周 coverage window

### Symptom B
```sql
SELECT prompt_type, substring(template_text, 1, 200) AS preview
FROM prompt_templates
WHERE prompt_type IN ('engine_a_hot_radar', 'engine_b_hot_radar', 'synthesizer_prompt');
```
输出里 Engine A 说自己是 "DeepSeek V3.2"，Engine B 说自己是 "Moonshot Kimi K2-0905" —— 都与真实模型不符。

## 3. Root cause

### Symptom A 根因

**两条并行因素叠加**：

1. **API-level recency 只在 GLM 上被设置了**。`loop.ts` 对 GLM 的 Stage 2 传 `searchRecency: 'oneMonth'`（太宽），对 Moonshot 则根本没有这个参数（Moonshot `$web_search` 不暴露 recency knob）。
2. **Prompt 层没有时间约束**。`shared_deep_dive`（Stage 2 两 engine 共用）以及 Stage 1 两个 hot-radar prompt 里，反幻觉规则只管"内容必须有来源"，没管"来源必须在 coverage window 内"。AI 拿到的数据没经过时间筛选后，自由发挥把旧内容当作本周事实呈现。

### Symptom B 根因

历史遗留：两次 Engine 切换（2026-05-01 AM Moonshot direct、2026-05-02 GLM swap）都**只改了代码里的模型常量**，没同步更新 DB prompt 的 self-identification 段。

## 4. Scope of fix — 贯穿整个 radar report 的时间分层语义

User 明确表态："这是贯穿整个 radar report 的逻辑"—— fix 不能只打在 Stage 2，需要覆盖整条流水线。

具体对齐语义：**"雷达"探测的是本周热度，不是本周首发**。

- **Topic 层**：允许跨时间。长期议题（欧盟免税、关联封号、KYC 政策等）只要本周在卖家社区有讨论热度就是合法 topic
- **Evidence 层**（quote / case / painpoints / 量化观察 / narrative 里的"本周痛点描述"）：必须在 `{start_date} ~ {end_date}` 窗口内
- **政策背景 / 法规原文 / 平台规则**：可以是历史的，但必须明确标注"背景说明"或"政策参考"，不能当成本周动态呈现

Litmus test（给 AI 判断）：**这条内容是在回答"本周卖家有多痛 / 多吵 / 多慌"吗？是 → 必须窗口内；否（是在回答"这事是什么 / 为什么"）→ 可以历史，但标注**。

## 5. What is IN scope for this fix

- 把 GLM 的 Stage 2 `searchRecency` 从 `'oneMonth'` 收紧到 `'oneWeek'`（code 1 行改动）
- 给 3 个 DB-editable prompt（`engine_a_hot_radar` / `engine_b_hot_radar` / `shared_deep_dive`）都追加"时间分层约束"段
- 同时在这次 migration 里修复 Symptom B（3 个 prompt 的 self-identification 句与真实模型对齐）
- synthesizer prompt 不需要加时间约束（它不接触原始搜索；只需要对齐 engine identity 句）

## 6. What is NOT in scope (explicit non-goals)

- **Engine 权重调整**：用户一度想过让 GLM 比重更高，但决定先不做（采样量太少，cross-engine confirmation 的核心机制不能破坏）。未来一个独立 spec
- **post-processing 过滤**：想过根据 `published_date` 字段在 `normalizeDeepDive` 里硬过滤 quote / case，但需要 `EngineSearchReference` 新增字段 + 数据结构改动，成本大于收益。本次靠 prompt 约束 + API recency 足够
- **Moonshot API 级 recency**：Moonshot 的 `$web_search` 本身不支持 recency filter。本次只靠 prompt 约束兜底
- **Voice volume 公式调整**：保持 forum×1 / provider×2 / media×4 / kol×5 不变

## 7. Preservation invariants (what must NOT break)

- `kimi_output` / `gemini_output` JSONB shape 不变（只改 prompt 文本 + 一个 API 参数）
- Voice volume 公式不变
- Top5 排序算法 / cross_engine_confirmed 逻辑 / merged_score 不变
- Module 固定顺序 不变
- 所有现有字段 schema 不变
- 任何现有 unit test 必须仍然绿

## 8. Acceptance criteria

1. 在 `loop.ts` 里 GLM 的 Stage 2 `searchRecency === 'oneWeek'`
2. `prompt_templates` 表 3 条 prompt（engine_a/b/synthesizer）的 template_text 符合新 persona
3. 3 个 Stage prompt（engine_a_hot_radar / engine_b_hot_radar / shared_deep_dive）包含新的"时间分层约束"段，措辞一致
4. `npm run build` 零错误
5. 现有测试 16/16 pass（不破坏）
6. 手动触发一次 run → 新 draft 的 quotes 日期全部落在当周 coverage window 内（或明确标注为"背景"/"参考"）
7. 同一次 run 里，Stage 1 的 topic 排序反映"本周热度"而不是"历史政策累积"

## 9. Out of scope explicitly flagged for future work

- 真正 time-window-aware 的 reference 过滤（需要 schema 改动）
- GLM 引擎权重实验（需要 5-10 次采样）
- Stage 3 education-mapper / Stage 4 assembler 的 system prompt（代码里，不是 DB 里；本次只动 DB-editable 部分）
