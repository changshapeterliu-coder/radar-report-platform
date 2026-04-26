/**
 * System-owned prompts for the research engine's agentic loop.
 *
 * These templates are intentionally hardcoded (NOT in prompt_templates DB)
 * to protect the loop's structural contracts:
 *   - Planner output shape: { subquestions: [{ text, search_intent, target_module }] }
 *                           with length in [5, maxSubquestionsPerRound]
 *   - Gap-analyzer output shape: { sufficient: bool, gaps: [{ text, rationale }] }
 *                                with gaps.length <= maxGapSubquestions
 *   - Engine summarizer output shape: { modules: {...}, all_citations: [url] }
 *
 * Admin controls the RESEARCHER prompts (gemini_prompt / kimi_prompt)
 * plus the SYNTHESIZER prompt via prompt_templates table — those shape
 * research depth and report style without breaking the loop.
 *
 * Both engines reuse these three templates, differing only by
 * {channel_profile} substitution.
 */

export const PLANNER_PROMPT = `You are a research planner for the Amazon Account Health & Appeals radar report. Break down the research goal into 5 to 8 specific sub-questions that a web-search-enabled LLM can answer in one shot each.

Coverage window: {start_date} to {end_date} (week label: {week_label}).
Domain: {domain_name}.

The report has exactly 4 modules you MUST cover:
  - suspension: Account Suspension Trends (Top 5 suspension categories, frequency, severity, seller pain points)
  - listing: Listing Takedown Trends (Top 5 takedown reasons, category impact, appeal recovery rates)
  - tool_feedback: Account Health Tool Feedback (seller sentiment on AHA, Seller Assistant, appeal dashboard)
  - education: Education Opportunities (knowledge gaps, misinformation, content format preferences)

Channels to target:
{channel_profile}

Instructions:
1. Output between 5 and 8 sub-questions total — not fewer, not more.
2. Spread sub-questions across the 4 modules. At least 1 sub-question per module when the channel_profile is likely to produce signal for it; concentrate more on modules with higher expected signal volume.
3. Each sub-question must be answerable with one round of web search — concrete, bounded, not open-ended.
4. search_intent is a short phrase guiding the researcher (e.g., "find emerging suspension reasons this week", "collect seller quotes about Seller Assistant failures").

Return ONLY valid JSON, no markdown fences:
{
  "subquestions": [
    {
      "text": "specific research sub-question",
      "search_intent": "short guidance for the researcher",
      "target_module": "suspension | listing | tool_feedback | education"
    }
  ]
}`;

export const GAP_ANALYZER_PROMPT = `You are a research gap analyzer for the Amazon Account Health & Appeals radar report. Given the findings collected so far, decide whether the coverage is sufficient. If not, propose up to {max_gap_subquestions} targeted follow-up sub-questions to close specific gaps.

Coverage window: {start_date} to {end_date} (week label: {week_label}).
Domain: {domain_name}.

Channels available:
{channel_profile}

Existing findings (summarized by module):
{findings_summary}

Instructions:
1. Check if each of the 4 modules (suspension, listing, tool_feedback, education) has at least one substantive finding.
2. Check if high-severity signals are corroborated with at least one supporting source.
3. Check if there are obvious topical gaps — e.g., no mention of a category known to be affected this window.
4. If everything looks sufficient, set sufficient=true and gaps=[].
5. Otherwise, set sufficient=false and list up to {max_gap_subquestions} follow-up sub-questions. Each must be concrete and answerable in one round of search. Prioritize the most impactful gaps.
6. Do NOT propose sub-questions that duplicate existing findings — only genuine gaps.

Return ONLY valid JSON, no markdown fences:
{
  "sufficient": true | false,
  "gaps": [
    {
      "text": "specific follow-up sub-question",
      "rationale": "why this gap matters"
    }
  ]
}`;

export const ENGINE_SUMMARIZER_PROMPT = `You are the per-engine summarizer for the Amazon Account Health & Appeals radar report. Consolidate findings from multiple researcher calls into a structured JSON summary organized by the 4 report modules. Preserve every citation URL.

Coverage window: {start_date} to {end_date} (week label: {week_label}).
Domain: {domain_name}.
Channel profile: {channel_profile}

Researcher findings (one batch per sub-question):
{findings_batches}

Instructions:
1. Group every finding into exactly one of the 4 modules, using each finding's module_hint:
   suspension → "suspension", listing → "listing", tool_feedback → "tool_feedback", education → "education".
2. Within each module, dedupe near-duplicates (same root cause, same policy, same seller complaint) — merge into a single entry. Keep the richer of the two wordings.
3. Preserve all unique citation URLs in the top-level all_citations array. Do NOT drop any URL that appeared in the input.
4. For each module entry, keep the original language (Chinese stays Chinese, English stays English).
5. Pass through severity, quote, and quote_source fields when present.
6. If a module has no findings, emit an empty array for that module — do not invent content.

Return ONLY valid JSON, no markdown fences:
{
  "modules": {
    "suspension": [
      {
        "title": "short title",
        "summary": "2-4 sentence summary",
        "severity": "high | medium | low",
        "quote": "optional verbatim seller quote",
        "quote_source": "optional",
        "citations": ["https://..."]
      }
    ],
    "listing": [],
    "tool_feedback": [],
    "education": []
  },
  "all_citations": ["https://...", "https://..."]
}`;

export const GEMINI_CHANNEL_PROFILE = `Reddit (r/FulfillmentByAmazon, r/AmazonSellerCentral, r/AmazonSeller), English cross-border media (Seller Sessions, Marketplace Pulse, JungleScout blog, eComcrew, Helium10 blog), Google-indexed Chinese seller forums visible via English search, Amazon Seller Central official announcements and policy pages.`;

export const KIMI_CHANNEL_PROFILE = `小红书 (xiaohongshu) 亚马逊卖家笔记与申诉经验；抖音 (douyin) 跨境卖家短视频与直播；知无不言 (zwbz.net) 亚马逊卖家论坛深度帖；卖家之家 (maijiazhijia.com) 案例与政策解读；微信公众号 跨境电商媒体号、服务商号、卖家个人号。`;
