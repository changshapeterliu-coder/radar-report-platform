/**
 * translate-content — unified translator for `reports.content` and
 * `news` (title / summary / content) JSONB fields.
 *
 * Replaces two separate inline OpenRouter fetch paths:
 *   - src/app/api/reports/[id]/publish/route.ts
 *   - src/app/api/news/route.ts
 *
 * Reliability (Principle 2 — constraint over prompt):
 *   - `response_format: json_object` API constraint
 *   - fence stripping for providers that still wrap in ``` despite the above
 *   - structural validation after parse (title/modules shape, or news shape)
 *   - on parse/shape failure → throws; Inngest retries the step
 *
 * Language policy (Requirements: Principle 3):
 *   - Detect direction via broad Chinese-character presence on the combined
 *     source text (not a regex on first 50 chars — that's the old bug).
 *   - Target language = opposite direction.
 *   - Reports body preserves v4 Markdown structure (see system prompt).
 */

import type { ReportContent } from '@/types/report';

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openrouter/auto';
const REQUEST_TIMEOUT_MS = 120_000;

type Direction = 'zh-to-en' | 'en-to-zh';

function detectDirection(sourceText: string): Direction {
  // If >= 10% of characters are CJK Unified Ideographs, treat as Chinese
  // source. Otherwise English. This replaces the old buggy first-50-chars
  // regex that misfired on mixed-language titles.
  let cjk = 0;
  let total = 0;
  for (const ch of sourceText) {
    if (ch.trim().length === 0) continue;
    total++;
    if (/[\u4e00-\u9fff]/.test(ch)) cjk++;
  }
  if (total === 0) return 'zh-to-en';
  return cjk / total >= 0.1 ? 'zh-to-en' : 'en-to-zh';
}

function targetLangName(dir: Direction): string {
  return dir === 'zh-to-en' ? 'English' : 'Chinese (Simplified)';
}

function stripCodeFences(s: string): string {
  const trimmed = s.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : trimmed;
}

async function callOpenRouter(params: {
  systemPrompt: string;
  userPrompt: string;
  apiKey: string;
}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `OpenRouter ${res.status} ${res.statusText}: ${body.slice(0, 300)}`
      );
    }
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('OpenRouter returned empty content');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Report translation ──────────────────────────────────────────────

const REPORT_SYSTEM_PROMPT = (lang: string) =>
  `You are a professional bilingual translator for Amazon seller account-health reports.

You receive a ReportContent JSON object. Translate ALL Chinese text values in the following fields to ${lang}:

TEXT FIELDS TO TRANSLATE:
- top-level: title, dateRange
- each module: title, subtitle, markdown
- each module.topTopics[]: topic, seller_discussion, keywords[] (translate each keyword)
- each module.topTools[]: tool_name, key_feedback_points[]
- each module.topEducationOpps[]: theme, target_audience, recommended_format[]
- any legacy fields (tables / analysisSections / highlightBoxes / blocks): translate every text value

PRESERVE (DO NOT TRANSLATE):
- JSON structure and every key name
- Numeric fields: voice_volume, rank (keep "1 ✓" / "2 ✓" rank strings as-is; only translate the checkmark stays)
- Enum values: severity (high/medium/low), sentiment (positive/neutral/negative/mixed), urgency
- Marketplace codes (BR, CA, US, UK, DE, JP, FR, IT, ES, MX, AU, AE, SG, NL, SE, PL, TR, EG)
- Acronyms: KYC, VAT, EPR, TRO, IP, ASIN, FBA, SKU

SPECIAL RULE FOR MARKDOWN bodies:
- Inside each markdown string, translate prose but PRESERVE Markdown syntax:
  - Keep ##, ### heading markers
  - Keep > [!INSIGHT] / > [!WARNING] / > [!RECOMMENDATION] / > [!STAT] / > [!QUOTE] directive tags unchanged
  - Keep --- separators
  - Keep table pipes | and alignment rows
  - Translate only human-readable text in blockquotes, paragraphs, list items, and table cells

Domain terminology (use these exactly):
  账户健康 = Account Health
  封号 / 停用 = account suspension
  下架 = listing takedown
  申诉 = appeal
  卖家 = seller
  审核 = review

Return ONLY the translated ReportContent JSON. Keep EXACT same key names and structure.`;

function validateReportContentShape(v: unknown): asserts v is ReportContent {
  if (!v || typeof v !== 'object') {
    throw new Error('Translation output is not an object');
  }
  const o = v as Record<string, unknown>;
  if (typeof o.title !== 'string' || o.title.trim().length === 0) {
    throw new Error('Translation output missing non-empty `title`');
  }
  if (!Array.isArray(o.modules)) {
    throw new Error('Translation output missing `modules[]`');
  }
}

export async function translateReportContent(
  content: ReportContent
): Promise<ReportContent> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const sourceText = JSON.stringify(content);
  const dir = detectDirection(sourceText);
  const lang = targetLangName(dir);

  const raw = await callOpenRouter({
    apiKey,
    systemPrompt: REPORT_SYSTEM_PROMPT(lang),
    userPrompt: `Translate to ${lang}:\n\n${sourceText}`,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Translation output is not valid JSON: ${msg}`);
  }
  validateReportContentShape(parsed);
  return parsed;
}

// ─── News translation ────────────────────────────────────────────────

export interface NewsTranslatableFields {
  title: string;
  summary: string | null;
  content: string;
}

export interface NewsTranslatedFields {
  title: string;
  summary: string | null;
  content: string;
}

const NEWS_SYSTEM_PROMPT = (lang: string) =>
  `You are a professional translator for Amazon seller account-health news items.

Input: a JSON object with "title" (string), "summary" (string or null), "content" (string, may contain Markdown).

Translate every text value to ${lang}. Preserve Markdown syntax inside "content" (headings, lists, links, emphasis). Preserve marketplace codes (BR, CA, US, UK, DE, JP, FR, IT, ES, MX, AU, AE, SG, NL, SE, PL, TR, EG) and acronyms (KYC, VAT, EPR, TRO, IP, ASIN, FBA, SKU). Keep the null for "summary" if input is null.

Domain terminology:
  账户健康 = Account Health
  封号 = account suspension
  下架 = listing takedown
  申诉 = appeal
  卖家 = seller

Return ONLY a JSON object of the form:
{ "title": "...", "summary": "..." or null, "content": "..." }`;

function validateNewsShape(v: unknown): asserts v is NewsTranslatedFields {
  if (!v || typeof v !== 'object') throw new Error('News translation is not an object');
  const o = v as Record<string, unknown>;
  if (typeof o.title !== 'string' || o.title.trim().length === 0) {
    throw new Error('News translation missing non-empty `title`');
  }
  if (o.summary !== null && typeof o.summary !== 'string') {
    throw new Error('News translation `summary` must be string or null');
  }
  if (typeof o.content !== 'string' || o.content.trim().length === 0) {
    throw new Error('News translation missing non-empty `content`');
  }
}

export async function translateNewsContent(
  fields: NewsTranslatableFields
): Promise<NewsTranslatedFields> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const sourceText = JSON.stringify(fields);
  const dir = detectDirection(sourceText);
  const lang = targetLangName(dir);

  const raw = await callOpenRouter({
    apiKey,
    systemPrompt: NEWS_SYSTEM_PROMPT(lang),
    userPrompt: `Translate to ${lang}:\n\n${sourceText}`,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`News translation is not valid JSON: ${msg}`);
  }
  validateNewsShape(parsed);
  return parsed;
}
