import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { extractTopTopicsForModule } from '../extract-top-topics';

/**
 * Example / mock tests for the Smart Paste topic-extraction LLM-call wrapper
 * (`extractTopTopicsForModule`). These mock `fetch` and exercise the wrapper's
 * failure taxonomy + happy path end-to-end (network → envelope → JSON content →
 * normalizeExtractedTopics), complementing the pure property tests in
 * `extract-top-topics.test.ts`.
 *
 * Spec: .kiro/specs/smart-paste-topic-extraction
 * Feature: smart-paste-topic-extraction, Task 3.2
 */

// ── Helpers — build OpenRouter-shaped chat-completion responses ──────────────
//
// The wrapper reads `envelope.choices[0].message.content` and JSON-parses that
// string. So a "success" response is a 200 whose `content` is a JSON string of
// `{ topics: [...] }`.

/** A 200 envelope whose message content is the given object/string serialized. */
function llmResponse(content: unknown): Response {
  const contentStr =
    typeof content === 'string' ? content : JSON.stringify(content);
  const body = { choices: [{ message: { content: contentStr } }] };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A non-2xx response — the signal that the route would not honor response_format. */
function httpErrorResponse(status = 502): Response {
  return new Response('upstream error', { status, statusText: 'err' });
}

/** A valid candidate row that survives normalization into a schema-valid TopTopic. */
function validCandidate(rank: string, topic: string) {
  return {
    rank,
    topic,
    voice_volume: 12,
    keywords: ['封号', '申诉'],
    seller_discussion: '卖家讨论该话题的核心原因',
    severity: '高',
  };
}

const API_KEY = 'sk-test-key';
// Non-empty markdown so the wrapper does NOT short-circuit the empty-body path
// and actually hits the (mocked) network.
const PROSE_MARKDOWN =
  '## 账户暂停趋势\n\n本期卖家反馈集中在账户暂停申诉处理周期过长，以及二次审核反复要求补充材料。';

describe('extractTopTopicsForModule', () => {
  const fetchMock = vi.fn<(url: unknown, init?: unknown) => Promise<Response>>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('non-2xx (both attempts) → { topics: [], dropped: 0, failed: true }, no throw (R5.2, R5.4)', async () => {
    // Both the json_schema attempt and the json_object fallback return non-2xx.
    fetchMock.mockResolvedValue(httpErrorResponse(502));

    const result = await extractTopTopicsForModule({
      markdown: PROSE_MARKDOWN,
      apiKey: API_KEY,
    });

    expect(result).toEqual({ topics: [], dropped: 0, failed: true });
    // A format rejection triggers exactly one json_object fallback retry.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('malformed JSON in message content → { topics: [], failed: true }, no throw (R5.2, R6.1)', async () => {
    // 200 envelope, but the content string is not parseable JSON → terminal failure.
    fetchMock.mockResolvedValue(llmResponse('not json at all {{{'));

    const result = await extractTopTopicsForModule({
      markdown: PROSE_MARKDOWN,
      apiKey: API_KEY,
    });

    expect(result.failed).toBe(true);
    expect(result.topics).toEqual([]);
    // Malformed content is terminal — no format fallback, single attempt.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborted signal → { topics: [], failed: true }, no throw (R5.2)', async () => {
    // Honor the abort: reject with an AbortError when the request signal is aborted.
    fetchMock.mockImplementation((_url, init) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      if (signal?.aborted) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      }
      return Promise.resolve(llmResponse({ topics: [] }));
    });

    const controller = new AbortController();
    controller.abort(); // already-aborted signal passed by the caller

    const result = await extractTopTopicsForModule({
      markdown: PROSE_MARKDOWN,
      apiKey: API_KEY,
      signal: controller.signal,
    });

    expect(result.failed).toBe(true);
    expect(result.topics).toEqual([]);
    // Abort is terminal — no fallback retry.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('one invalid + two valid rows → 2 topics, dropped: 1, failed: false (R6.1, R5.3)', async () => {
    fetchMock.mockResolvedValue(
      llmResponse({
        topics: [
          validCandidate('1', '账户暂停申诉'),
          { rank: '2', topic: '   ' }, // empty/whitespace topic → dropped
          validCandidate('3', 'Listing takedown'),
        ],
      })
    );

    const result = await extractTopTopicsForModule({
      markdown: PROSE_MARKDOWN,
      apiKey: API_KEY,
    });

    expect(result.failed).toBe(false);
    expect(result.dropped).toBe(1);
    expect(result.topics).toHaveLength(2);
    expect(result.topics.map((t) => t.topic)).toEqual([
      '账户暂停申诉',
      'Listing takedown',
    ]);
  });

  it('valid response with empty topics, no error → failed: false, topics [] (R5.4)', async () => {
    // Genuine empty: the LLM returned no candidates because the section has no topics.
    fetchMock.mockResolvedValue(llmResponse({ topics: [] }));

    const result = await extractTopTopicsForModule({
      markdown: PROSE_MARKDOWN,
      apiKey: API_KEY,
    });

    expect(result).toEqual({ topics: [], dropped: 0, failed: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('prose-derived candidates (no table in body) → topics produced, confirming no table pre-gate (R2.4)', async () => {
    // The markdown body is pure prose (no Markdown table), yet the wrapper still
    // calls the LLM and produces topics — proving extraction is not gated on a table.
    expect(PROSE_MARKDOWN).not.toContain('|'); // sanity: the body has no table
    fetchMock.mockResolvedValue(
      llmResponse({
        topics: [
          validCandidate('1', '账户暂停申诉处理周期'),
          validCandidate('2', '二次审核反复补充材料'),
        ],
      })
    );

    const result = await extractTopTopicsForModule({
      markdown: PROSE_MARKDOWN,
      apiKey: API_KEY,
    });

    expect(result.failed).toBe(false);
    expect(result.topics.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('request body includes an API-level response_format constraint (R6.2)', async () => {
    fetchMock.mockResolvedValue(llmResponse({ topics: [] }));

    await extractTopTopicsForModule({
      markdown: PROSE_MARKDOWN,
      apiKey: API_KEY,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse((init as { body: string }).body) as {
      response_format?: { type?: string };
    };
    expect(sentBody.response_format).toBeDefined();
    // First attempt uses the json_schema API constraint, never prompt-only.
    expect(sentBody.response_format?.type).toBe('json_schema');
  });
});
