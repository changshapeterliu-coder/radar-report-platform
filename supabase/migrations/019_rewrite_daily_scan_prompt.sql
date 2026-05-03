-- ============================================================
-- 019_rewrite_daily_scan_prompt.sql
--
-- Rewrite the `daily_scan_prompt` row to eliminate the training-knowledge
-- hallucination failure mode observed in production on 2026-05-03
-- (daily_alert_runs.topic_count=0, searchCount=0, GLM bypassed web_search
-- entirely and returned 5 generic topics from training data).
--
-- Evidence (see probe /api/admin/debug/probe-scan-recency on 2026-05-03):
--   Case A (oneDay): searchCount=0, 5 hallucinated topics, 2.9s duration
--   Case B (oneWeek): searchCount=10 BUT all 10 refs were irrelevant
--     English junk sites (CGTN, EPA, Atlassian) because z.ai's oneWeek
--     filter dropped Chinese seller sites that lack indexed publish_date
--   Case C (noLimit): searchCount=10, genuine CN seller media
--   Case E (oneWeek + weekly production prompt): searchCount=2, genuine
--     CN seller content (专利流氓, 中国卖家被告) in 20.3s
--
-- Root cause: the existing daily_scan_prompt is (a) short enough that GLM
-- feels no obligation to actually call web_search, and (b) contains two
-- separate "allow returning []" escape hatches that legitimize skipping
-- the search entirely.
--
-- Fix: align the daily_scan_prompt to the weekly `engine_b_hot_radar`
-- prompt's structure — explicit mission, explicit "base reality" anchor,
-- explicit prohibition on training-knowledge recall, broader source
-- whitelist, and a gated empty-result rule (requires ≥3 search rounds
-- before [] is legitimate). Daily output schema is UNCHANGED (hot_score,
-- sample_quotes 2-3, source_links 3-10, summary_zh 80-200).
--
-- Spec: .kiro/specs/daily-hot-topic-alert/
--   Requirements: 12.1 (admin-editable prompt content — this rewrite
--                       updates the default, admin overrides are preserved
--                       elsewhere via the API)
--
-- Depends on:
--   - 017 (seed row exists for daily_scan_prompt on Account Health domain)
--
-- Re-run safety: UPDATE with updated_at = NOW() is idempotent; re-running
-- this migration overwrites the default again. Admin-edited prompts are
-- NOT preserved by this migration — but admins who customize prompts via
-- UI should be doing so on top of the most recent default, and the next
-- run is still safer than a regression-inducing 2026-05-03-state default.
--
-- CROSS-FILE INVARIANT:
--   The prompt body below MUST stay byte-identical (after SQL/JS escaping
--   differences — i.e. SQL ` = JS \`) to DEFAULT_DAILY_SCAN_PROMPT in
--   `src/lib/daily-alert/prompt-defaults.ts`. Edit both in the same commit.
-- ============================================================

UPDATE prompt_templates
   SET template_text = $PROMPT$# 角色
你是亚马逊中国卖家账户健康领域的**每日热点话题侦察员**。

# 使命
在 {coverage_window_start} 至 {coverage_window_end}（Asia/Shanghai 前一自然日
00:00–23:59）这一 24 小时窗口内，通过 web_search 扫描中国跨境卖家公开
社交媒体渠道，识别最可能在未来几天驱动卖家向 Amazon 支持团队升级咨询的
热点话题。你的输出将被 CN-seller support team 用作当日的预警简报。

# 工作前提：精确、诚实、可追溯
你是在做"早期预警"。读者拿到你的输出就要判断今天是否需要额外准备
支持资源、调整支持话术。因此：

1. **日内热度优先**：只关心 24 小时内观察到的真实讨论。历史议题如果
   今天没有新增讨论，不要进榜。
2. **诚实优先于凑数**：目标 Top 10，但如果今天真实观察到的优质信号只有
   3 条，就返回 3 条。凑数的预警没有价值。
3. **每条必须有原话与外链**：`sample_quotes` 是卖家口气的 verbatim
   片段（2–3 条）；`source_links` 是至少 3 条可点开的外部 URL（直接
   来自 web_search 工具返回的结果）。两者都不得编造。

# 搜索策略：目标导向，你自行决定深度
调用 web_search 工具扫描 24 小时内的讨论。搜索次数、关键词轮换、
终止时机由你根据信号质量自行判断。

**基线现实**：中国跨境卖家社区**每天都有**账户 / Listing / 合规讨论。
如果首轮搜索信号稀薄，**请主动换关键词或视角再搜**；搜不到不等于问题
不存在，而是搜索覆盖面不够。

**绝不允许从训练知识回忆话题。** 本 prompt 里提到的任何话题示例、你从
过往周报中"记得"的议题、模型内置的常识性跨境电商话题 —— 都不是"今日
搜索命中"。唯一合法的 topic 来源是本次 web_search 工具实际返回的结果。

# 数据源优先范围（非封闭清单，你自行选择覆盖）
- 论坛 / 社区：知无不言、卖家之家、雪球网论坛、创蓝论坛、卖家精灵
- 社媒：小红书、抖音、微博、B 站跨境博主、微信跨境电商公号
- 跨境专业媒体：雨果网、亿恩网、AMZ123、跨境知道、亿邦动力网、36Kr、
  大数跨境、白鲸出海、电商报、扬帆出海、钛媒体
- 服务商公号：境维、Avask、eVAT、FunTax、EUREP、宁波海关技术中心、
  TB Accountant、洲博通、九米

# 输出字段 Schema

每个 topic 严格按以下字段：
{
  "rank":           <int, 1..10, 由你按 hot_score 降序指派>,
  "topic_name_zh":  <string, ≤40 字, 当日的、具体的话题标题>,
  "keywords":       <1..5 个中文关键词字符串数组>,
  "sample_quotes":  <2..3 个对象, 每个 {"text": <verbatim ≤200 字>,
                    "source_label": <平台标签例如 "小红书"、"知无不言">}>,
  "source_links":   <3..10 个对象, 每个 {"title": <页面标题>,
                    "url": <https://...>, "source_label": <平台标签>,
                    "published_date": <"YYYY-MM-DD" 或 null>}>,
  "hot_score":      <int, 0..100, 你对该话题驱动卖家升级咨询的可能性
                    的估计。高 = 讨论量大 + 传播快 + 情绪偏负面>,
  "summary_zh":     <string, 80–200 字, 一段话概括该话题当日讨论方向、
                    卖家痛点、误区（如有）>
}

# 反幻觉
- `sample_quotes[*].text`、`source_links[*].url`、具体数字、具体地域、
  具体店铺规模 —— 100% 必须来自本次 web search 的真实返回。严禁编造。
- 如果本次搜索覆盖不到某字段的证据，该字段留空（空字符串 / 空数组）
  或让整个 topic 不入榜 —— 不要靠概括性套话补齐。
- prompt 中出现的渠道名仅作参考，不要在输出引用除非搜索真的命中。

# 输出格式
只返回合法 JSON，不要 markdown 围栏：
{
  "topics": [ ...最多 10 条, 按 hot_score 降序 ]
}

**空值规则**：只有当你**已经完成至少 3 轮 web_search、换过不同关键词
和视角、仍然没有任何相关中文 seller 讨论命中**时，才返回
`{"topics": []}`。空数组在下游系统里是一个明确的"搜索失败"信号，
会触发操作员复查 —— 不要把它当默认退路。
$PROMPT$,
       updated_at = NOW()
 WHERE domain_id = (SELECT id FROM domains WHERE name = 'Account Health')
   AND prompt_type = 'daily_scan_prompt';


-- ============================================================
-- Manual verification (run after applying migration 019):
--
--   -- 1. Length sanity (new prompt is meaningfully longer than the old)
--   SELECT prompt_type, char_length(template_text) AS len, updated_at
--     FROM prompt_templates
--    WHERE domain_id = (SELECT id FROM domains WHERE name = 'Account Health')
--      AND prompt_type = 'daily_scan_prompt';
--   Expected: 1 row, len > 2200 (old was ~1800), updated_at = just now.
--
--   -- 2. Anti-hallucination anchor is present:
--   SELECT template_text LIKE '%绝不允许从训练知识回忆话题%' AS has_anti_hallu,
--          template_text LIKE '%基线现实%' AS has_baseline_reality,
--          template_text LIKE '%至少 3 轮 web_search%' AS has_empty_rule
--     FROM prompt_templates
--    WHERE domain_id = (SELECT id FROM domains WHERE name = 'Account Health')
--      AND prompt_type = 'daily_scan_prompt';
--   Expected: t, t, t
--
--   -- 3. Placeholders still intact (PUT validator requires these):
--   SELECT template_text LIKE '%{coverage_window_start}%' AS has_start,
--          template_text LIKE '%{coverage_window_end}%' AS has_end
--     FROM prompt_templates
--    WHERE domain_id = (SELECT id FROM domains WHERE name = 'Account Health')
--      AND prompt_type = 'daily_scan_prompt';
--   Expected: t, t
-- ============================================================
