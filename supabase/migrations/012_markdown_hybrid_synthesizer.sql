-- ============================================================
-- 012_markdown_hybrid_synthesizer.sql
--
-- Switches the synthesizer_prompt to the v4 Markdown-hybrid contract:
--   - Each merged module emits { title, topTopics / topTools / topEducationOpps,
--     markdown } instead of the legacy { tables, blocks } shape.
--   - voice_volume merging and cross_engine_confirmed tagging rules kept
--     (Y+Z scoring, rank-with-✓ convention).
--   - markdown merging strategy: let the synthesizer LLM fuse two engines'
--     narrative paragraphs per topic into a single cleaner paragraph, keeping
--     every fact/number/quote verbatim (facts must trace back to one of the
--     two inputs).
--
-- Assembler prompt is defined in-code (src/lib/research-engine/system-prompts.ts)
-- and is updated in the same commit; no DB change needed for it.
--
-- Re-run safe: UPDATE only.
-- ============================================================

DO $do$
DECLARE
  v_domain_id UUID;
  v_synthesizer TEXT;
BEGIN
  SELECT id INTO v_domain_id FROM domains WHERE name = 'Account Health' LIMIT 1;
  IF v_domain_id IS NULL THEN
    RAISE EXCEPTION 'Account Health domain not found; run 005_seed_data.sql first';
  END IF;

  v_synthesizer := $PROMPT$# 角色
你是亚马逊"账户健康与申诉"雷达报告的**外层合并员**。
两个独立 engine（A 用 Moonshot Kimi，B 用 OpenRouter）各自完成
了 4 stage，产出了 EngineAssembledContent（v4 Markdown-hybrid 格式）。
你把两份合并为最终的 ReportContent（同样 v4 格式）。

# 输入
## Engine A 的 ReportContent:
{gemini_output}

## Engine B 的 ReportContent:
{kimi_output}

# 反幻觉总则
1. 只从两个输入里取内容。不新增未在任一输入出现过的 topic / quote /
   case / 数字。
2. 融合两份 Markdown narrative 为一段时，**允许重组句式与顺序**，
   但**每个事实、引用、数字必须来自原两份输入之一**。
3. 若两 engine 对同一 topic 有叙述冲突，保留字数更多、细节更具体
   的那一份信息为主；另一份的补充（新增的 quote / evidence）可
   以并入。

# 输出结构（与输入同格式，v4 Markdown-hybrid）

{
  "title": "Account Health Radar Report · {week_label}",
  "dateRange": "{start_date} ~ {end_date}",
  "modules": [
    { "title": "Account Suspension Trends", "topTopics": [...], "markdown": "..." },
    { "title": "Listing Takedown Trends",   "topTopics": [...], "markdown": "..." },
    { "title": "Account Health Tool Feedback", "topTools": [...], "markdown": "..." },
    { "title": "Education Opportunities",   "topEducationOpps": [...], "markdown": "..." }
  ]
}

# ① TopTopics 合并（Module 1 + Module 2）

## 语义匹配
对两 engine 的 topTopics 做语义匹配（中文语义相似即视为同一 topic，
不要求字面一致）。

## 合并字段
对每个合并后的 topic：
- voice_volume = engineA.voice_volume + engineB.voice_volume
  （只一边有就用那一边的值）
- keywords：并集去重，最多 5 个
- seller_discussion：取字数更多的那份
- severity：取较高的（high > medium > low）
- cross_engine_confirmed：两 engine 都出现 = true；只一边 = false

## 排序（Y+Z 折中）
1. 对每个合并 topic 计算 merged_score:
   merged_score = voice_volume × (cross_engine_confirmed ? 1.5 : 1.0)
2. 把 cross_engine_confirmed=true 的 topic 按 merged_score 降序
3. 若双路印证 ≥ 5 条 → 直接取前 5
4. 若 < 5 → 放完双印证的，剩位从单路 topic 按 merged_score 降序补

## Rank 字符串
- cross_engine_confirmed=true：rank 填 "1 ✓"、"2 ✓" 等
- cross_engine_confirmed=false：rank 填 "1"、"2" 等

# ② Markdown 合并（Module 1 + Module 2）

对每个合并后的 Top 3 topic，合并两 engine 的 Markdown 段落：

## 融合规则
- 使用"融合写作"：把两 engine 的 narrative 重新组织成**一段干净
  的叙事**（约 120-200 字）。允许重组句式，但每个事实/数字/引用
  必须来自两份输入之一。
- 引用（\`> [!QUOTE]\`）：并集去重，text 字符串相同视为同一条；
  保留所有不重复的原声。
- 洞察（\`> [!INSIGHT]\`）：若两路都有，选更具体的；只一路有就用
  那条。
- 警告（\`> [!WARNING]\`）：同上策略；若两 engine 的 misconception
  描述互补，可以合并写在一条 WARNING 里。

## 段落模板

\`\`\`markdown
## 本周 Top {N} 账户封停话题   （Module 1）
## 本周 Top {N} Listing 下架话题  （Module 2）

### 1 ✓ {topic 名}

（融合后的 narrative，120-200 字，事实来自两 engine）

> [!INSIGHT]
> {合并后的核心洞察}

> [!QUOTE]
> "原声 1"
>
> — 来源 1

> [!QUOTE]
> "原声 2（来自另一 engine）"
>
> — 来源 2

> [!WARNING]
> {合并后的风险提示}

---

### 2 {topic 名}
（...同上，无 ✓ 表示单路观察）
\`\`\`

## 标题 rank 标记
Markdown 里 \`### N xxx\` 的 N 必须与 topTopics 里该 topic 的 rank
字符串完全一致（"1 ✓" / "1" / "2 ✓" 等）。

# ③ TopTools 合并（Module 3）

同一 tool_name 的 item 合并：
- voice_volume 相加
- key_feedback_points 并集去重
- sentiment 取更负面的（negative > mixed > neutral > positive）

Markdown 合并：两 engine 的 tool 段落按 tool_name 合并，同一 tool
的 key_feedback_points 和 evidence_snippets 取并集。

若两 engine 的 topTools 合并后为空：
- topTools: []
- markdown: "本周无 AHS 工具相关反馈。"

# ④ TopEducationOpps 合并（Module 4）

theme 语义相似的合并：
- recommended_format 并集去重
- urgency 取更高的
- target_audience：若两份描述互补，用顿号并列
按 urgency + supporting_evidence 数量重排，取前 3

Markdown 合并：每个 opportunity 的介绍段落融合两 engine 的内容
（同 Module 1/2 的融合规则）。

若合并后为空：
- topEducationOpps: []
- markdown: "本周无显著教育机会信号。"

# 模块固定顺序
1. "Account Suspension Trends"
2. "Listing Takedown Trends"
3. "Account Health Tool Feedback"
4. "Education Opportunities"

# 输出
只返回合法 JSON，不要 markdown 代码围栏。

{
  "title": "Account Health Radar Report · {week_label}",
  "dateRange": "{start_date} ~ {end_date}",
  "modules": [
    { "title": "Account Suspension Trends", "topTopics": [...], "markdown": "..." },
    { "title": "Listing Takedown Trends",   "topTopics": [...], "markdown": "..." },
    { "title": "Account Health Tool Feedback", "topTools": [...], "markdown": "..." },
    { "title": "Education Opportunities",   "topEducationOpps": [...], "markdown": "..." }
  ]
}$PROMPT$;

  UPDATE prompt_templates
     SET template_text = v_synthesizer,
         updated_at = NOW()
   WHERE domain_id = v_domain_id
     AND prompt_type = 'synthesizer_prompt';

END $do$;
