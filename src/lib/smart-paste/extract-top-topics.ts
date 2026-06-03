import type { TopTopic } from '@/types/report';
import { TopTopicSchema } from '@/lib/validators/report-schema';

/**
 * ── Smart Paste topic extraction — code-owned correctness core ──
 *
 * Pure, synchronous functions that turn the loose candidate rows an LLM emits
 * (from a Markdown table OR summarized from prose) into clean, schema-valid
 * `TopTopic[]`. Per Principle 2, structural correctness lives here in code —
 * NOT in the LLM prompt and NOT in a pre-call table/shape detector. The LLM
 * (see `extractTopTopicsForModule`, added separately) owns summarization
 * quality; this module owns: documented defaults, the empty-`topic`
 * no-fabrication rail, Zod validation, source-order ranking, and the cap.
 *
 * The single async LLM-call wrapper (`extractTopTopicsForModule`) is added in a
 * later task and reuses `normalizeExtractedTopics` from here.
 */

/**
 * Loose shape the LLM is asked to emit per identified topic — every field is
 * optional so a missing value never fails JSON parsing; defaults are applied in
 * code. Works identically for table rows and prose-summarized topics.
 */
export interface RawTopicCandidate {
  rank?: string | number;
  topic?: string;
  voice_volume?: number | string;
  keywords?: string[] | string;
  seller_discussion?: string;
  /** Free text: 高/中/低, 高风险/中风险/低风险, high/medium/low, … */
  severity?: string;
}

/** Documented default severity when the source gives no determinable level (R1.4). */
export const DEFAULT_SEVERITY: TopTopic['severity'] = 'medium';

/** Mirrors `ReportModuleV4Schema`'s `topTopics` cap. */
export const MAX_TOPICS_PER_MODULE = 10;

/** Mirrors `TopTopicSchema`'s `keywords` cap. */
export const MAX_KEYWORDS = 10;

/** Separators a single keyword string may use: ideographic, half-width, full-width comma. */
const KEYWORD_SEPARATORS = /[、,，]/;

/**
 * Map one free-text severity value to high/medium/low. Recognizes English
 * (high/medium/low) and Chinese (高/中/低, 高风险/中风险/低风险) forms. Returns
 * `DEFAULT_SEVERITY` when undeterminable (R1.4) — never omits, never throws.
 */
export function coerceSeverity(raw: unknown): TopTopic['severity'] {
  if (raw === 'high' || raw === 'medium' || raw === 'low') return raw;
  if (typeof raw !== 'string') return DEFAULT_SEVERITY;

  const s = raw.trim();
  if (!s) return DEFAULT_SEVERITY;

  const lower = s.toLowerCase();
  if (lower.includes('high')) return 'high';
  if (lower.includes('medium') || lower === 'med' || lower === 'mid') return 'medium';
  if (lower.includes('low')) return 'low';

  // Chinese: check 高/低 before 中 (no overlap, but explicit order is clearer).
  if (s.includes('高')) return 'high';
  if (s.includes('低')) return 'low';
  if (s.includes('中')) return 'medium';

  return DEFAULT_SEVERITY;
}

/**
 * Map a heat/volume value to a non-negative number. Numbers pass through when
 * finite and non-negative; numeric-leading strings (e.g. "45件") are parsed;
 * non-numeric / missing / negative → `0` (R1.3). Never throws.
 */
export function coerceVoiceVolume(raw: unknown): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? raw : 0;
  }
  if (typeof raw === 'string') {
    const n = parseFloat(raw.trim());
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return 0;
}

/**
 * Resolve a candidate's rank into a non-empty label string plus a numeric sort
 * key. Explicit source numbering (a finite number, or a string containing a
 * number) is kept verbatim as the label; otherwise the 1-based order of
 * appearance is used. Never re-ranks — source order is the author's ranking (R1.5).
 */
function resolveRank(
  rawRank: unknown,
  order: number
): { label: string; sortKey: number } {
  if (typeof rawRank === 'number' && Number.isFinite(rawRank)) {
    return { label: String(rawRank), sortKey: rawRank };
  }
  if (typeof rawRank === 'string') {
    const trimmed = rawRank.trim();
    const match = trimmed.match(/-?\d+(?:\.\d+)?/);
    if (trimmed && match) {
      return { label: trimmed, sortKey: parseFloat(match[0]) };
    }
  }
  return { label: String(order), sortKey: order };
}

/** Split / trim / dedupe a candidate's keywords and cap at `MAX_KEYWORDS` (R1.2). */
function coerceKeywords(raw: unknown): string[] {
  const sources: string[] = Array.isArray(raw)
    ? raw.filter((k): k is string => typeof k === 'string')
    : typeof raw === 'string'
      ? [raw]
      : [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const source of sources) {
    for (const part of source.split(KEYWORD_SEPARATORS)) {
      const k = part.trim();
      if (k && !seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out.slice(0, MAX_KEYWORDS);
}

/**
 * The correctness core. Takes the raw candidate topics the LLM emitted (from a
 * table or summarized from prose) and produces a clean, schema-valid
 * `TopTopic[]`:
 *   1. Coerce each field, applying documented defaults (R1.2 / R1.3 / R1.4).
 *   2. Drop rows whose `topic` is empty/whitespace — the code-owned
 *      no-fabrication rail, independent of source shape (R2.3 / R3.1 / R3.5).
 *   3. Cap / trim / dedupe keywords at `MAX_KEYWORDS` (R1.2).
 *   4. Assign `rank` from explicit source numbering when present, else the
 *      1-based order of appearance — never re-ranked (R1.5).
 *   5. Validate each row against `TopTopicSchema`; drop rows that still fail (R6.1).
 *   6. Sort by rank ascending; cap at `MAX_TOPICS_PER_MODULE`, keeping the
 *      highest-ranked rows (R1.5).
 *
 * Pure — no I/O, deterministic, idempotent.
 */
export function normalizeExtractedTopics(
  candidates: RawTopicCandidate[]
): TopTopic[] {
  if (!Array.isArray(candidates)) return [];

  const rows: Array<{ topic: TopTopic; sortKey: number; order: number }> = [];
  let order = 0;

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;

    const topic =
      typeof candidate.topic === 'string' ? candidate.topic.trim() : '';
    // No-fabrication rail: a row with no real topic is never kept.
    if (!topic) continue;

    order += 1;
    const { label, sortKey } = resolveRank(candidate.rank, order);

    const built: TopTopic = {
      rank: label,
      topic,
      voice_volume: coerceVoiceVolume(candidate.voice_volume),
      keywords: coerceKeywords(candidate.keywords),
      seller_discussion:
        typeof candidate.seller_discussion === 'string'
          ? candidate.seller_discussion
          : '',
      severity: coerceSeverity(candidate.severity),
    };

    // Defensive Zod pass (Principle 2): rows are valid by construction, but a
    // failed parse is dropped rather than returned.
    const parsed = TopTopicSchema.safeParse(built);
    if (!parsed.success) continue;

    rows.push({ topic: parsed.data, sortKey, order });
  }

  // Sort by rank ascending; appearance order as a deterministic tiebreaker so
  // the result is stable and idempotent regardless of engine sort stability.
  rows.sort((a, b) => a.sortKey - b.sortKey || a.order - b.order);

  return rows.slice(0, MAX_TOPICS_PER_MODULE).map((r) => r.topic);
}

// ════════════════════════════════════════════════════════════════════════════
// LLM-call wrapper — the synthesizer analogue (best-effort, never throws)
// ════════════════════════════════════════════════════════════════════════════
//
// One constrained OpenRouter call per module body, then `normalizeExtractedTopics`
// on the result. Per Principle 2 the call is bound by an API-level
// `response_format` (json_schema, falling back to json_object — never
// prompt-only), and `normalizeExtractedTopics` owns structural correctness after
// the call. This wrapper is the ONLY async / IO surface in the module; the
// functions above stay pure.
//
// It NEVER throws. Every failure mode (non-2xx after fallback, timeout/abort,
// network error, empty content, unparseable JSON, valid-JSON-wrong-shape,
// all-candidate-rows-dropped) resolves to `{ topics: [], dropped, failed }` so a
// single module's extraction can never block the interactive Smart Paste
// response (R5.2 / R6.3). `failed` separates an extraction failure from a
// genuine "this section has no topic content" empty (R5.4).

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** Matches the rest of the platform's OpenRouter calls (format-report, canonicalize, AI Insight news). */
const EXTRACTION_MODEL = 'openrouter/auto';

/**
 * Interactive budget — the admin is waiting on Smart Paste (Principle 1's
 * exception). Bounds the whole wrapper, including a possible json_object retry.
 * The route also passes its own per-module `AbortSignal.timeout(45_000)`; this
 * internal timer is the backstop when the wrapper is called without a signal.
 */
const MODULE_EXTRACTION_TIMEOUT_MS = 45_000;

/**
 * Synthesizer analogue (R6.4): identify + condense the top topics in ANY shape,
 * never invent, keep the source language, preserve source order as `rank`. The
 * explicit `{ "topics": [...] }` shape doubles as the json_object-mode
 * instruction (which requires the word JSON in the prompt).
 */
const EXTRACTION_SYSTEM_PROMPT = `You are a report topic extractor. You are given the body of ONE section of a radar report about Amazon seller account health. Identify the top topics it describes — in WHATEVER shape they appear: a Markdown table, free-form prose, a bullet list, or numbered paragraphs. This is the same job the auto-run report synthesizer does: identify and condense the top topics, not merely parse table rows.

For each topic, produce:
- "rank": the topic's position in the source. Use the source's own numbering when present (a rank column, or 1/2/3 ordinals); otherwise use the order it appears. Never re-rank or substitute your own importance judgment — source order is the author's ranking.
- "topic": a short topic name.
- "keywords": the keywords / terms the source associates with the topic.
- "seller_discussion": a one-line summary of the seller discussion / core reason / misconception, condensed from the source.
- "voice_volume": a heat / volume number if the source states one; omit it otherwise.
- "severity": the heat / risk level if the source states one (高/中/低, 高风险/中风险/低风险, or high/medium/low); omit it otherwise.

Rules:
- You MAY condense prose into a topic name, keywords, and a one-line summary.
- You MUST NOT invent topics, keywords, or numbers that the source does not support. Ground every value in the pasted content.
- Keep the original language — Chinese stays Chinese, English stays English. Do not translate.
- If the section genuinely contains no topic content, return an empty list.

Return ONLY a JSON object of this exact shape:
{ "topics": [ { "rank": "1", "topic": "...", "keywords": ["..."], "seller_discussion": "...", "voice_volume": 0, "severity": "high" } ] }`;

/**
 * API-level JSON-schema constraint describing `{ topics: RawTopicCandidate[] }`
 * (R6.2). Non-strict so the optional candidate fields are honored; if the route
 * rejects json_schema we fall back to json_object below. Code — not this schema —
 * owns final correctness, so the schema only has to bias the decode toward shape.
 */
const TOPICS_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'extracted_top_topics',
    schema: {
      type: 'object',
      properties: {
        topics: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              rank: { type: ['string', 'number'] },
              topic: { type: 'string' },
              voice_volume: { type: ['number', 'string'] },
              keywords: { type: 'array', items: { type: 'string' } },
              seller_discussion: { type: 'string' },
              severity: { type: 'string' },
            },
            required: ['topic'],
            additionalProperties: false,
          },
        },
      },
      required: ['topics'],
      additionalProperties: false,
    },
  },
} as const;

/** Lighter API-level constraint, the fallback when a route rejects json_schema. */
const JSON_OBJECT_RESPONSE_FORMAT = { type: 'json_object' } as const;

const FAILED_RESULT: { topics: TopTopic[]; dropped: number; failed: boolean } = {
  topics: [],
  dropped: 0,
  failed: true,
};

/**
 * Per-attempt outcome. `rejected` (non-2xx) is the only kind that triggers the
 * json_object fallback — it is the signal that the route would not honor the
 * requested `response_format`. `failed` (network / timeout / empty / malformed /
 * wrong-shape) is terminal: retrying with a different format would not help and
 * would burn the interactive budget.
 */
type AttemptOutcome =
  | { kind: 'ok'; candidates: RawTopicCandidate[] }
  | { kind: 'rejected' }
  | { kind: 'failed' };

/**
 * Pull the candidate array out of parsed-but-untrusted JSON. Accepts both the
 * documented `{ topics: [...] }` object and a bare top-level array. Returns
 * `null` when valid JSON arrived in a shape with no candidate array (treated as
 * a malformed extraction, not a genuine empty).
 */
function extractCandidatesArray(parsed: unknown): RawTopicCandidate[] | null {
  if (Array.isArray(parsed)) return parsed as RawTopicCandidate[];
  if (parsed && typeof parsed === 'object') {
    const topics = (parsed as { topics?: unknown }).topics;
    if (Array.isArray(topics)) return topics as RawTopicCandidate[];
  }
  return null;
}

/** Strip a single outer ```json / ``` fence some routes add despite response_format. */
function stripExtractionFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\r?\n?/i, '')
    .replace(/\r?\n?```$/, '')
    .trim();
}

/**
 * Async wrapper: one constrained LLM call for one module body, then
 * `normalizeExtractedTopics` on the result. Never throws — see the module
 * banner above for the full failure taxonomy.
 *
 * `dropped` = candidate rows the LLM returned minus rows that survived
 * normalization. `failed` is `true` for any extraction error AND for the
 * all-candidates-dropped case (the LLM produced rows but none were valid —
 * "produces an invalid TopTopic structure", R5.4); it is `false` for a genuine
 * empty (the LLM returned no candidates because the section has no topics).
 */
export async function extractTopTopicsForModule(args: {
  markdown: string;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<{ topics: TopTopic[]; dropped: number; failed: boolean }> {
  const { markdown, apiKey, signal } = args;

  // Can't even attempt without a key → failure (R5.4: surfaced, not silent).
  if (!apiKey) return { ...FAILED_RESULT };

  // Empty body has genuinely no topic content — skip the call, genuine empty.
  if (typeof markdown !== 'string' || markdown.trim().length === 0) {
    return { topics: [], dropped: 0, failed: false };
  }

  // Single bounded budget across both attempts; also chained to the caller's
  // signal so an aborted paste tears the request down immediately.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    MODULE_EXTRACTION_TIMEOUT_MS
  );
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const attempt = async (
    responseFormat: unknown
  ): Promise<AttemptOutcome> => {
    let res: Response;
    try {
      res = await fetch(OPENROUTER_ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          // OpenRouter recommends these for server-side calls; some upstream
          // provider routes return 4xx without them.
          'HTTP-Referer': 'https://radar-report-platform.vercel.app',
          'X-Title': 'Radar Report Platform',
        },
        body: JSON.stringify({
          model: EXTRACTION_MODEL,
          messages: [
            { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Identify the top topics described in this report section and return them as the JSON object specified. If there is genuinely no topic content, return { "topics": [] }.\n\n---\n${markdown}\n---`,
            },
          ],
          response_format: responseFormat,
        }),
      });
    } catch {
      // Abort / timeout / network — terminal, do not fall back.
      return { kind: 'failed' };
    }

    // Non-2xx → the route would not honor the format → caller may fall back.
    if (!res.ok) return { kind: 'rejected' };

    let envelope: unknown;
    try {
      envelope = await res.json();
    } catch {
      return { kind: 'failed' };
    }

    const content = (
      envelope as { choices?: Array<{ message?: { content?: unknown } }> }
    )?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      return { kind: 'failed' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripExtractionFences(content));
    } catch {
      return { kind: 'failed' };
    }

    const candidates = extractCandidatesArray(parsed);
    if (candidates === null) return { kind: 'failed' };
    return { kind: 'ok', candidates };
  };

  try {
    let outcome = await attempt(TOPICS_RESPONSE_FORMAT);

    // Fall back to json_object only on a format rejection, and only if the
    // budget hasn't already been spent (R6.2 — still an API constraint).
    if (outcome.kind === 'rejected' && !controller.signal.aborted) {
      outcome = await attempt(JSON_OBJECT_RESPONSE_FORMAT);
    }

    if (outcome.kind !== 'ok') return { ...FAILED_RESULT };

    const { candidates } = outcome;
    const topics = normalizeExtractedTopics(candidates);
    const dropped = candidates.length - topics.length;

    // candidates empty → genuine empty (failed:false). candidates present but
    // none survived → invalid structure produced (failed:true, R5.4).
    const failed = candidates.length > 0 && topics.length === 0;

    return { topics, dropped, failed };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}
