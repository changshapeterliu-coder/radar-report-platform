import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { callQwen } from '../qwen-client';

// ─────────────────────────────────────────────────────────
// Response builders — mirror real DashScope OpenAI-compat shape
// ─────────────────────────────────────────────────────────

function successResponse(opts: {
  contentJson: string;
  searchResults?: Array<{ index: number; title: string; url: string; snippet?: string }>;
  searchCount?: number;
}): Response {
  const body: Record<string, unknown> = {
    id: 'chatcmpl-test',
    choices: [
      {
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: opts.contentJson,
          ...(opts.searchResults
            ? { search_info: { search_results: opts.searchResults } }
            : {}),
        },
      },
    ],
  };
  if (opts.searchCount !== undefined) {
    body.usage = {
      input_tokens: 100,
      output_tokens: 50,
      plugins: { search: { count: opts.searchCount, strategy: 'agent' } },
    };
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, body = 'err'): Response {
  return new Response(body, { status, statusText: 'err' });
}

// ─────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────

describe('callQwen', () => {
  const fetchMock = vi.fn<(url: unknown, init?: unknown) => Promise<Response>>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fast-path: returns parsed JSON + refs when Step 1 already emits strict JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      successResponse({
        contentJson: JSON.stringify({ foo: 'bar' }),
        searchResults: [
          {
            index: 1,
            title: '1688 跨境店铺二审',
            url: 'https://www.cifnews.com/article/99999',
            snippet: '跨境卖家讨论...',
          },
          {
            index: 2,
            title: '小红书账户封停分享',
            url: 'https://www.xiaohongshu.com/explore/xyz',
          },
        ],
        searchCount: 2,
      })
    );

    const result = await callQwen<{ foo: string }>({
      model: 'qwen3-max',
      messages: [
        { role: 'system', content: 'you are Qwen' },
        { role: 'user', content: '搜本周话题,返 JSON' },
      ],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.foo).toBe('bar');
    expect(result.searchCount).toBe(2);
    expect(result.searchReferences).toHaveLength(2);
    expect(result.searchReferences[0].provider).toBe('qwen');

    // Fast path: only ONE HTTP call — Step 2 skipped.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('two-step path: Step 1 returns prose, Step 2 structures it into JSON', async () => {
    fetchMock
      // Step 1: prose output with search_info attached
      .mockResolvedValueOnce(
        successResponse({
          contentJson:
            '这是根据搜索整理的结果:\n\n1. 品牌关联封号 - voice_volume 高\n2. 二审资料 - 中等',
          searchResults: [
            { index: 1, title: '雨果网文章', url: 'https://www.cifnews.com/x' },
          ],
          searchCount: 1,
        })
      )
      // Step 2: strict JSON output
      .mockResolvedValueOnce(
        successResponse({
          contentJson: JSON.stringify({
            account_health_topics: [
              { topic: '品牌关联封号', voice_volume: 6.2 },
              { topic: '二审资料', voice_volume: 3.5 },
            ],
          }),
        })
      );

    const result = await callQwen<{
      account_health_topics: unknown[];
    }>({
      model: 'qwen3-max',
      messages: [
        { role: 'system', content: 'Return JSON with {account_health_topics: [...]}' },
        { role: 'user', content: '本周话题' },
      ],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.account_health_topics).toHaveLength(2);
    // Search refs come from Step 1
    expect(result.searchReferences).toHaveLength(1);
    expect(result.searchReferences[0].url).toBe('https://www.cifnews.com/x');
    expect(result.searchCount).toBe(1);
    // Two HTTP calls
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('Step 1 sends enable_search WITHOUT response_format', async () => {
    fetchMock.mockResolvedValueOnce(
      successResponse({ contentJson: '{}' })
    );

    await callQwen({
      model: 'qwen3-max',
      messages: [{ role: 'system', content: 'return JSON' }],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    // Fast-path means only 1 call — the Step-1 call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse((init as { body: string }).body) as {
      enable_search: boolean;
      search_options: { search_strategy: string };
      response_format?: unknown;
    };
    expect(sent.enable_search).toBe(true);
    expect(sent.search_options.search_strategy).toBe('agent');
    // Critical: response_format must be absent in Step 1 (rejected by Qwen when search is on).
    expect(sent.response_format).toBeUndefined();
  });

  it('Step 2 sends response_format=json_object WITHOUT enable_search', async () => {
    fetchMock
      .mockResolvedValueOnce(
        // Step 1: non-JSON prose → forces Step 2
        successResponse({ contentJson: '这是整理的自然语言内容,非 JSON' })
      )
      .mockResolvedValueOnce(
        successResponse({ contentJson: '{"ok": true}' })
      );

    await callQwen<{ ok: boolean }>({
      model: 'qwen3-max',
      messages: [{ role: 'system', content: 'Return JSON' }],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, step2Init] = fetchMock.mock.calls[1];
    const sent = JSON.parse((step2Init as { body: string }).body) as {
      enable_search?: boolean;
      response_format?: { type: string };
    };
    // Step 2 must NOT have enable_search (this is the point — decouple)
    expect(sent.enable_search).toBeUndefined();
    // And Step 2 MUST have response_format for strict JSON
    expect(sent.response_format?.type).toBe('json_object');
  });

  it('classifies 401 as CreditsExhausted (no retry)', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, 'Invalid API key'));

    const result = await callQwen({
      model: 'qwen3-max',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-bad',
      timeoutMs: 10_000,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.errorClass).toBe('CreditsExhausted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on transient 500 then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(500, 'upstream down'))
      .mockResolvedValueOnce(successResponse({ contentJson: '{"ok":true}' }));

    const result = await callQwen<{ ok: boolean }>({
      model: 'qwen3-max',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.ok).toBe(true);
    // 1 retry + 1 success = 2 calls (all in Step 1 because fast-path kicks in)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails with MalformedResponse when Step 2 returns non-JSON', async () => {
    fetchMock
      .mockResolvedValueOnce(successResponse({ contentJson: '自然语言内容' }))
      .mockResolvedValueOnce(successResponse({ contentJson: 'still not json' }));

    const result = await callQwen({
      model: 'qwen3-max',
      messages: [{ role: 'system', content: 'Return JSON' }],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.errorClass).toBe('MalformedResponse');
    expect(result.error.message).toContain('step-2');
  });

  it('dedupes search references by URL', async () => {
    fetchMock.mockResolvedValueOnce(
      successResponse({
        contentJson: '{}',
        searchResults: [
          { index: 1, title: 'A', url: 'https://example.com/a' },
          { index: 2, title: 'A copy', url: 'https://example.com/a' },
          { index: 3, title: 'B', url: 'https://example.com/b' },
        ],
      })
    );

    const result = await callQwen({
      model: 'qwen3-max',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.searchReferences).toHaveLength(2);
  });
});
