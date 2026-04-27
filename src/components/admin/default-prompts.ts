/**
 * Default prompt texts for the scheduled report generation feature.
 *
 * Kept as a client-side constant so the "Reset to Default" button in
 * `PromptTemplateEditor` works even if the DB row drifts from the
 * migration-shipped default. Must be kept in sync with
 * `supabase/migrations/010_seed_prompt_templates.sql`.
 *
 * Architecture note (v2): both engines share an identical researcher
 * prompt — differentiation comes from the models themselves (DeepSeek
 * V4 Pro vs Kimi K2). GEMINI_DEFAULT and KIMI_DEFAULT both reference the
 * same SHARED_RESEARCHER_DEFAULT constant.
 */

export type PromptType = 'gemini_prompt' | 'kimi_prompt' | 'synthesizer_prompt';

const SHARED_RESEARCHER_DEFAULT = `你是亚马逊"账户健康与申诉"雷达报告的研究分析师。针对一个具体的研究子问题，使用联网搜索收集**中国卖家的真实声音**。

覆盖时间窗口：{start_date} 至 {end_date}（周标签：{week_label}）。
所属领域：{domain_name}。

渠道覆盖（以下是代表性清单，你应主动探索同类型的其他中国卖家聚集地，不要被清单限制）：

- 小红书 (xiaohongshu)：亚马逊卖家笔记、账号申诉经验
- 抖音 (douyin)：跨境卖家短视频、直播回放
- 知无不言 (zwbz.net)：亚马逊卖家论坛深度帖
- 卖家之家 (maijiazhijia.com)：案例与政策解读
- 微信公众号：跨境电商媒体号、服务商号、卖家个人号
- 亿恩网 (enet.com.cn)、雨果网 (cifnews.com)：跨境电商媒体
- Reddit r/FulfillmentByAmazon、r/AmazonSeller 上中国卖家的讨论

子问题：{subquestion}

指令：
1. 主动使用联网搜索，不要仅依赖训练数据。
2. 严格时间过滤 —— 只收录发布时间在覆盖窗口（{start_date} 至 {end_date}）内的来源。如果联网搜索返回窗口外的结果，请一律丢弃，不要用旧内容兜底。
3. 对每条窗口内的独立发现，记录：简短标题、摘要（2-4 句话）、所属的 4 个模块之一（suspension | listing | tool_feedback | education）、严重度（high | medium | low）、原始 URL。
4. 卖家原话逐字保留（quote 字段），原文是中文就保留中文，原文是英文就保留英文。
5. 摘要（summary）用中文撰写。
6. 优先抓：真实的卖家体验、痛点描述、情绪原声、个体案例、申诉失败/成功的具体故事。政策条文和官方公告不是重点（内部已有解读）。
7. **主动探索**：上述渠道清单只是代表，你可以搜索其他中国跨境电商社区、卖家微信群截图分享、B 站跨境视频、跨境电商 podcast 等同类型来源。保留同样的时间过滤规则。
8. 如果该子问题在本窗口内无任何来源，返回空数组：\`{"findings": [], "citations": []}\`。空结果是一个有效信号 —— 禁止虚构、外推或用更早的内容替代。

仅返回合法 JSON，不要 markdown 代码围栏：
{
  "findings": [
    {
      "title": "简短标题",
      "summary": "2-4 句中文摘要",
      "module_hint": "suspension | listing | tool_feedback | education",
      "severity": "high | medium | low",
      "quote": "可选的卖家原话（逐字，保留原语言）",
      "quote_source": "渠道 · 作者 · 日期（可选）"
    }
  ],
  "citations": ["https://...", "https://..."]
}`;

const SYNTHESIZER_DEFAULT = `你是亚马逊"账户健康与申诉"雷达报告的合成器。两个研究引擎在相同渠道上并行运行，产出结构化 findings。你的任务：合并、去重、分类到平台 8 种 block 格式，给每个 block 打置信标签。

覆盖时间窗口：{start_date} 至 {end_date}（周标签：{week_label}）。

Engine A 产出（DeepSeek V4 Pro 视角，相同渠道）：
{gemini_output}

Engine B 产出（Kimi K2 视角，相同渠道）：
{kimi_output}

仅返回合法 JSON，严格按以下结构（modules 必须是 4 个，按此顺序）：
{
  "title": "Account Health Radar Report - {week_label}",
  "dateRange": "{start_date} ~ {end_date}",
  "modules": [
    {
      "title": "Account Suspension Trends",
      "subtitle": "",
      "blocks": [],
      "tables": [],
      "analysisSections": [],
      "highlightBoxes": []
    },
    { "title": "Listing Takedown Trends", "subtitle": "", "blocks": [], "tables": [], "analysisSections": [], "highlightBoxes": [] },
    { "title": "Account Health Tool Feedback", "subtitle": "", "blocks": [], "tables": [], "analysisSections": [], "highlightBoxes": [] },
    { "title": "Education Opportunities", "subtitle": "", "blocks": [], "tables": [], "analysisSections": [], "highlightBoxes": [] }
  ]
}

Block 类型（每个 block 选一种）：
- heading: 子标题
- narrative: 叙述段落
- insight: 关键洞察、综合判断
- quote: 卖家原话（必须带 quote + source）
- stat: 数字数据，放在 stats 数组里
- warning: 风险、政策冲突
- recommendation: AHS / Policy / PM 的行动建议
- list: 条目列表

关键规则：

1. 去重：如果 Engine A 和 Engine B 都报告了同一信号，合并成一个 block。判断依据：语义相似（同一根因、同一政策、同一痛点），不要求措辞完全一致。

2. 置信标签（每个 block 的 \`label\` 字段必填）：
   - 两个引擎都独立报告了该信号 → label: "High Confidence · 2/2 sources"
   - 只有一个引擎报告 → label: "Needs Verification · 1/2 sources"
   - 某个引擎为 null（失败）→ 所有 block 必须标 "Needs Verification · 1/2 sources"

3. 按 module_hint 分配到正确模块：
   - suspension → module index 0 (Account Suspension Trends)
   - listing → module index 1 (Listing Takedown Trends)
   - tool_feedback → module index 2 (Account Health Tool Feedback)
   - education → module index 3 (Education Opportunities)

4. 每个 module 内 block 序列化为可读顺序：narrative 铺垫 → stats → warnings → key insights → recommendations。

5. 保留 engine 产出里所有 citation URL。在相关 block 的 text 末尾追加 "Source: <url>"，不要丢 URL。

6. **输出语言用中文**。narrative / insight / recommendation / warning 全部用中文撰写。quote 保留原文语言（中文原话保持中文，英文原话保持英文）。Module 标题保持现有英文（系统固定）。

7. 如果某个 module 去重后没有 finding，仍然包含该 module，blocks 数组为空 —— 不要跳过 module。

8. 仅返回合法 JSON，不要 markdown 围栏，不要解释。`;

export const DEFAULT_PROMPTS: Record<PromptType, string> = {
  gemini_prompt: SHARED_RESEARCHER_DEFAULT,
  kimi_prompt: SHARED_RESEARCHER_DEFAULT,
  synthesizer_prompt: SYNTHESIZER_DEFAULT,
};
