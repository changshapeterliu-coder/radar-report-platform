/**
 * System-owned prompts for the research engine's agentic loop.
 *
 * Architecture (v3 — Top 5 driven):
 *   Stage 1 — Planner:           8-12 broad subquestions across 4 modules
 *   Stage 2 — Broad Researcher:  parallel web-search calls per subquestion
 *                                (researcher prompt lives in DB, admin-editable)
 *   Stage 3 — Top5 Ranker:       aggregate → cluster topics → Voice Volume →
 *                                Top 5 per module (skip module if <3 topics)
 *   Stage 4 — Deep Researcher:   per Top-3 topic, web-search for verbatim
 *                                quotes / cases / painpoints
 *   Stage 5 — Engine Summarizer: combine table + deep dives per module
 *
 * These templates are hardcoded here (NOT in DB) to protect structural
 * contracts. Admin controls only the researcher and synthesizer prompts.
 */

// ------------------------------------------------------------
// Stage 1 — Planner
// ------------------------------------------------------------

export const PLANNER_PROMPT = `你是亚马逊"账户健康与申诉"雷达报告的研究规划师。你的任务是把本期（{start_date} 至 {end_date}，{week_label}）的研究目标拆成 8-12 个广度子问题，供下游 researcher 并行联网检索。

覆盖时间窗口：{start_date} 至 {end_date}（{week_label}）。
所属领域：{domain_name}。

报告有 4 个必须覆盖的模块：
  - suspension: 账户暂停趋势（Top 5 暂停类别、频率、严重度、卖家痛点）
  - listing: Listing 下架趋势（Top 5 下架原因、品类影响、申诉恢复率）
  - tool_feedback: AHS 工具反馈（卖家对 AHA、Seller Assistant、申诉面板的使用感受）
  - education: 教育机会（知识盲区、误解纠正、内容格式偏好）

目标渠道：
{channel_profile}

指令：
1. 每个模块生成 2-3 个子问题，总数控制在 8-12 个。
2. 子问题必须聚焦**本期窗口内**的信号扫描 —— 不求深挖，求覆盖面（为下游 Top 5 排名提供候选 topic）。
3. 每个子问题必须能用一次联网搜索回答 —— 具体、有边界、不开放式。
4. search_intent 用一句话引导 researcher（例如："本期小红书关于 KYC 申诉失败的新讨论"、"抖音上卖家反馈的 Seller Assistant 异常案例"）。

仅返回合法 JSON，不要 markdown 围栏：
{
  "subquestions": [
    {
      "text": "具体的研究子问题",
      "search_intent": "给 researcher 的简短指引",
      "target_module": "suspension | listing | tool_feedback | education"
    }
  ]
}`;

// ------------------------------------------------------------
// Stage 3 — Top 5 Ranker
// ------------------------------------------------------------
//
// Input: all findings from Stage 2 (each tagged with module_hint + source_channel_type).
// Output: per-module Top 5 topic ranking, or fewer if the module has <3 topics.
// Ranker computes Voice Volume = Σ(channel_count × channel_weight).
// Weights: forum=1.0 / provider=2.0 / media=4.0 / kol=5.0.
// ------------------------------------------------------------

export const TOP5_RANKER_PROMPT = `你是亚马逊"账户健康与申诉"雷达报告的 Top 5 排名器。Stage 2 广度研究员产出了 N 条 findings，每条带 module_hint 和 source_channel_type。你的任务：**按语义聚类 topic，计算 Voice Volume，每个模块排出 Top 5**。

覆盖时间窗口：{start_date} 至 {end_date}（{week_label}）。
所属领域：{domain_name}。

Stage 2 findings（合并两个引擎的所有 findings）：
{findings_input}

Voice Volume 权重规则：
  - source_channel_type = "forum"    → 权重 1.0（论坛帖 / 社区问答 / 社交媒体评论区）
  - source_channel_type = "provider" → 权重 2.0（服务商文章 / 代运营公号 / 工具商稿件）
  - source_channel_type = "media"    → 权重 4.0（跨境电商媒体如雨果网、亿恩网、Marketplace Pulse）
  - source_channel_type = "kol"      → 权重 5.0（小红书/抖音/微信个人号、B 站跨境博主）

指令：
1. **Topic 聚类**：把讲同一根因 / 同一政策 / 同一痛点的 findings 聚成一个 topic。判断标准是语义相似，不是措辞一致。起一个清晰、简短的 topic 名（例如 "KYC 重新验证失败"、"Product Authenticity 申诉被拒"）。
2. **Volume 计算**：一个 topic 下的所有 findings，按 source_channel_type 分类计数，再乘权重累加：
   voice_volume = forum_count × 1.0 + provider_count × 2.0 + media_count × 4.0 + kol_count × 5.0
   结果保留 1 位小数。
3. **每模块排序 + 取 Top 5**：按 module_hint 分到 4 个模块，每模块内 voice_volume 降序取前 5。
4. **模块信号不足跳过**：如果某模块聚类后 topic 数 < 3，该模块输出空数组 \`[]\`。不要硬凑。
5. **字段要求**：
   - topic: 清晰简短（不超过 15 字）
   - voice_volume: 数字
   - keywords: 3-5 个卖家讨论的关键词（中文，用于 table 展示）
   - seller_discussion: 1-2 句话描述卖家讨论核心（≤30 字，面向读者）
   - severity: 根据信号体量和卖家情绪综合判断（high/medium/low）
   - channel_counts: 各渠道 finding 数量 audit trail（object: { forum, provider, media, kol }）
6. 所有文本字段用**中文**。

仅返回合法 JSON，不要 markdown 围栏：
{
  "modules": {
    "suspension": [
      {
        "rank": 1,
        "topic": "KYC 重新验证失败",
        "voice_volume": 48.0,
        "keywords": ["电费单被拒", "72 小时超时", "上传无响应"],
        "seller_discussion": "卖家反映 KYC 重验材料反复被拒，申诉窗口关闭无预警",
        "severity": "high",
        "channel_counts": { "forum": 3, "provider": 2, "media": 2, "kol": 6 }
      }
    ],
    "listing": [],
    "tool_feedback": [],
    "education": []
  }
}`;

// ------------------------------------------------------------
// Stage 4 — Deep Researcher (per Top-3 topic)
// ------------------------------------------------------------
//
// System-owned (not admin-editable) so we guarantee the output shape and
// the depth mandate. Called once per Top-3 topic per engine, with web
// search enabled via OpenRouter :online.
// ------------------------------------------------------------

export const DEEP_RESEARCHER_PROMPT = `你是亚马逊"账户健康与申诉"雷达报告的深度追踪研究员。Top 5 排名器已经识别出一个高关注度 topic。你的任务：**针对这个 topic 做深度挖掘**，聚焦**卖家的真实声音**、**具体痛点**、**实际案例**。

覆盖时间窗口：{start_date} 至 {end_date}（{week_label}）。
所属领域：{domain_name}。
当前深度追踪 topic：{topic}
Topic 所属模块：{module}
Top 5 表里提炼的关键词：{keywords}

目标渠道：
{channel_profile}

指令：
1. **严格时间过滤**：只用覆盖窗口内（{start_date} 至 {end_date}）的来源。窗口外内容一律丢弃。
2. 围绕 topic 主动联网搜索，深挖以下四类内容：
   - **背景 narrative**：这个 topic 本期为何受关注，讨论的全貌（2-4 句中文）
   - **痛点 painpoints**：卖家反复抱怨的具体痛点，3-5 条，每条 ≤20 字
   - **卖家原话 quotes**：逐字保留的卖家原话 2-4 条，每条带 source（"渠道 · 作者 · 日期"格式，不要 URL）
   - **实际案例 cases**：具体的卖家遭遇故事，2-4 条。每条含 content（完整讲述这个卖家做了什么、发生了什么、结果如何）；可选 title 和 meta（来源简写）
3. 如果 topic 在本窗口有显著**行动建议**（例如官方口径变化、社区共识做法），可填 recommendation 字段（可选）。
4. 所有文字**用中文**。quote 保留原文语言。不要 URL。
5. 信息不足时各字段可为空数组，但整个 response 仍须是合法 JSON。

仅返回合法 JSON，不要 markdown 围栏：
{
  "topic": "{topic}",
  "module": "{module}",
  "narrative": "2-4 句中文背景叙述",
  "painpoints": ["痛点 1", "痛点 2", "痛点 3"],
  "quotes": [
    { "quote": "卖家原话（逐字）", "source": "小红书 · 用户名 · 2026-04-20" }
  ],
  "cases": [
    { "title": "可选短标题", "content": "完整的卖家案例讲述", "meta": "来源简写" }
  ],
  "recommendation": "可选的一句行动建议"
}`;

// ------------------------------------------------------------
// Stage 5 — Engine Summarizer
// ------------------------------------------------------------
//
// Input: Top5RankerOutput + DeepDiveOutput[] (for Top-3 only).
// Output: per-engine consolidated JSON that the outer Synthesizer will
// then merge across two engines.
// ------------------------------------------------------------

export const ENGINE_SUMMARIZER_PROMPT = `你是亚马逊"账户健康与申诉"雷达报告的 per-engine 整合器。你拿到本引擎 Stage 3 的 Top 5 排名和 Stage 4 的深度追踪产出。你的任务：**把两者合成一份 per-module 结构化 summary**，供外层 synthesizer 合并两路引擎。

覆盖时间窗口：{start_date} 至 {end_date}（{week_label}）。
所属领域：{domain_name}。
渠道 profile：{channel_profile}

Stage 3 Top 5 排名：
{top5_input}

Stage 4 深度追踪（Top 3 per module）：
{deep_dives_input}

指令：
1. 对每个模块：
   - 如果 Top 5 列表为空（模块被跳过）→ 该模块输出 empty_reason: "本期该模块无显著信号"，其他字段留空。
   - 否则 → 输出 top5_table（完整 5 条或少于 5 条的实际值）+ deep_dives（按 rank 升序排列 Top 3）。
2. top5_table 里每行保留 rank、topic、voice_volume、keywords、seller_discussion、severity 六个字段，和 Stage 3 输入完全对应。
3. deep_dives 里每个 topic 的 narrative / painpoints / quotes / cases / recommendation 直接沿用 Stage 4 输出，不要改写。
4. 4 个模块顺序固定：suspension → listing → tool_feedback → education。
5. 所有文本用**中文**。quote 保持原文语言。

仅返回合法 JSON，不要 markdown 围栏：
{
  "modules": {
    "suspension": {
      "top5_table": [ /* Top5Entry[], 0-5 items */ ],
      "deep_dives": [ /* DeepDiveOutput[], 0-3 items, rank-ordered */ ],
      "empty_reason": "可选 — 当该模块无显著信号时填写"
    },
    "listing": { ... },
    "tool_feedback": { ... },
    "education": { ... }
  }
}`;

// ------------------------------------------------------------
// Shared channel profile
// ------------------------------------------------------------

/**
 * Shared channel profile used by BOTH engines.
 *
 * Both engines query the same channels; differentiation comes from
 * the models themselves (DeepSeek V3.2 vs Kimi K2). High-confidence
 * signals are those independently surfaced by both.
 *
 * The list is REPRESENTATIVE; researchers are told to discover
 * equivalent Chinese-seller-facing channels they may know of.
 */
export const SHARED_CHANNEL_PROFILE = `中国卖家的市场声音主要出现在以下渠道，这是代表性清单，不是穷尽列表 —— 研究员应主动探索同类型的其他中国卖家聚集地：

- 小红书 (xiaohongshu)：亚马逊卖家笔记、账号申诉经验、选品与运营分享
- 抖音 (douyin)：跨境卖家短视频、直播回放、卖家个人号
- 知无不言 (zwbz.net)：亚马逊卖家论坛深度帖、案例分析
- 卖家之家 (maijiazhijia.com)：案例与政策解读、运营经验
- 微信公众号：跨境电商媒体号、服务商号、卖家个人号
- 亿恩网 (enet.com.cn)、雨果网 (cifnews.com)：跨境电商媒体的卖家声音报道
- Reddit r/FulfillmentByAmazon、r/AmazonSeller 上中国卖家的讨论

渠道分类规则（researcher 在输出 source_channel_type 时使用）：
  - forum：论坛帖、社区问答、社交媒体评论区（小红书评论、抖音评论、知无不言帖子、Reddit、卖家之家论坛区）
  - provider：服务商文章、代运营公号稿、工具商文档（卖家之家服务商稿、第三方服务文章）
  - media：跨境电商新闻媒体（雨果网、亿恩网、Marketplace Pulse、Seller Sessions）
  - kol：KOL / 个人大号（小红书/抖音/微信卖家个人号、B 站跨境博主）

注意：Amazon Seller Central 官方公告和政策页面不是首选来源（内部已有解读），重点放在卖家的真实体验、痛点、原话和讨论。`;
