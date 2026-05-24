/**
 * Topic-rankings extraction.
 *
 * Pulled out of `src/app/api/reports/[id]/publish/route.ts` so the same
 * code path can be invoked from:
 *   - the publish API on each new publish
 *   - `scripts/backfill-topic-rankings.ts` to repair history
 *
 * The whole point of going through the LLM (rather than dropping raw
 * Chinese topic strings into `topic_rankings`) is **cross-week label
 * stability** — different weeks describe the same theme with slightly
 * different Chinese phrases ("账号关联问题" vs "账号被关联"). The trend
 * chart on the Dashboard joins on `topic_label`, so unstable labels =
 * isolated points = no trend.
 *
 * The LLM is instructed to reuse existing labels first and only mint a
 * new one if no semantic match exists. That keeps the label dictionary
 * naturally bounded over time without us shipping a hard-coded taxonomy.
 */

import type { ReportContent } from '@/types/report';

/**
 * Find the first array-typed value in a parsed JSON object.
 * Handles cases where the LLM returns the array wrapped under an
 * unpredictable key like `data`, `items`, `output`, etc.
 */
function pickFirstArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    for (const v of Object.values(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) return v;
    }
  }
  return null;
}

export interface TopicEntry {
  rank: number;
  topic_label: string;
  raw_reason: string;
  raw_keywords: string;
}

/**
 * Extract topics for one module of a report. Returns ranked TopicEntry[]
 * with stabilized English topic labels.
 *
 * Returns [] (not throws) on:
 *   - module missing
 *   - module has neither topTopics nor a legacy table[0].rows
 *   - LLM HTTP non-2xx (logged via the caller's responsibility)
 */
export async function extractTopicsForModule(
  content: ReportContent,
  moduleIndex: number,
  existingLabels: string[],
  apiKey: string
): Promise<TopicEntry[]> {
  const mod = content.modules?.[moduleIndex];
  if (!mod) return [];

  // v4 fast path: module already has structured topTopics.
  if (Array.isArray(mod.topTopics) && mod.topTopics.length > 0) {
    return stabilizeLabelsV4(mod.topTopics, existingLabels, apiKey);
  }

  // Legacy path: read from the first table.
  const table = mod?.tables?.[0];
  if (!table?.rows?.length) return [];

  const entries = table.rows.map((row, i) => ({
    rank: i + 1,
    reason: row.cells[1]?.text || row.cells[0]?.text || '',
    keywords: row.cells[2]?.text || '',
  }));

  const prompt = `You are a topic matching assistant. Given a list of report entries (each with a reason and keywords) and a list of existing standardized topic labels, your job is to:
1. For each entry, determine if it matches an existing topic label (semantic match, not exact string match)
2. If it matches, use the existing label
3. If it's a new topic, create a short standardized English label (max 40 chars)

Existing labels: ${JSON.stringify(existingLabels)}

Report entries:
${entries.map((e) => `Rank ${e.rank}: Reason="${e.reason}", Keywords="${e.keywords}"`).join('\n')}

Return ONLY a JSON array: [{ "rank": 1, "topic_label": "Account Association", "raw_reason": "Account Relation", "raw_keywords": "Broadband/Second review" }, ...]`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'openrouter/auto',
      messages: [
        { role: 'system', content: 'You are a topic classification assistant. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    console.error(
      `[topic-rankings] OpenRouter ${res.status} ${res.statusText} for legacy-path module ${moduleIndex}`
    );
    return [];
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || '[]';
  try {
    const parsed = JSON.parse(raw);
    const out = pickFirstArray(parsed);
    if (!out) {
      console.error(
        '[topic-rankings] legacy-path: LLM returned no array. Raw response:',
        raw.slice(0, 500)
      );
      return [];
    }
    return out as TopicEntry[];
  } catch (e) {
    console.error('[topic-rankings] failed to parse legacy-path response:', e, 'raw:', raw.slice(0, 500));
    return [];
  }
}

/**
 * v4 path: topTopics already has structured topic / keywords / discussion.
 * We still hit the LLM to map each Chinese topic to a stable English label
 * so the Dashboard trend chart can group across weeks.
 *
 * If the LLM call itself fails, fall back to using the raw Chinese topic
 * as the label. This keeps trending working (less-grouped, but visible)
 * rather than silently dropping the data.
 */
async function stabilizeLabelsV4(
  topics: NonNullable<ReportContent['modules'][number]['topTopics']>,
  existingLabels: string[],
  apiKey: string
): Promise<TopicEntry[]> {
  const entries = topics.map((t, i) => {
    const parsedRank = parseInt(t.rank, 10);
    return {
      rank: Number.isFinite(parsedRank) ? parsedRank : i + 1,
      topic: t.topic,
      keywords: t.keywords.join('、'),
      discussion: t.seller_discussion,
    };
  });

  const prompt = `You are a topic matching assistant. For each entry below, map its Chinese topic to a standardized English label (max 40 chars). Reuse existing labels when semantically equivalent.

Existing labels: ${JSON.stringify(existingLabels)}

Entries:
${entries.map((e) => `Rank ${e.rank}: Topic="${e.topic}", Keywords="${e.keywords}", Discussion="${e.discussion}"`).join('\n')}

Return ONLY a JSON array: [{ "rank": 1, "topic_label": "Account Association", "raw_reason": "Topic Chinese name", "raw_keywords": "Keywords list" }, ...]`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'openrouter/auto',
      messages: [
        { role: 'system', content: 'You are a topic classification assistant. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    console.error(
      `[topic-rankings] OpenRouter ${res.status} ${res.statusText} during stabilizeLabelsV4 — falling back to raw Chinese labels`
    );
    return entries.map((e) => ({
      rank: e.rank,
      topic_label: e.topic,
      raw_reason: e.topic,
      raw_keywords: e.keywords,
    }));
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || '[]';
  try {
    const parsed = JSON.parse(raw);
    const out = pickFirstArray(parsed);
    if (!out) {
      console.error(
        '[topic-rankings] stabilizeLabelsV4: LLM returned no array. Raw response:',
        raw.slice(0, 500)
      );
      return [];
    }
    return out as TopicEntry[];
  } catch (e) {
    console.error('[topic-rankings] failed to parse stabilizeLabelsV4 response:', e, 'raw:', raw.slice(0, 500));
    return [];
  }
}
