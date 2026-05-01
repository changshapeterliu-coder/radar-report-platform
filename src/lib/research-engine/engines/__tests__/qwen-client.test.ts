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

  it('parses JSON + extracts search references on success', async () => {
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
        { role: 'user', content: '搜本周话题' },
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

    const first = result.searchReferences[0];
    expect(first.url).toBe('https://www.cifnews.com/article/99999');
    expect(first.title).toBe('1688 跨境店铺二审');
    expect(first.provider).toBe('qwen');
    expect(first.stage).toBe('hot-radar-scan');
    expect(first.snippet).toBe('跨境卖家讨论...');
  });

  it('sends enable_search: true + search_options.agent in request body', async () => {
    fetchMock.mockResolvedValueOnce(
      successResponse({ contentJson: '{}' })
    );

    await callQwen({
      model: 'qwen3-max',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse((init as { body: string }).body) as {
      model: string;
      enable_search: boolean;
      search_options: { search_strategy: string; enable_source: boolean };
      response_format?: unknown;
    };
    expect(sent.model).toBe('qwen3-max');
    expect(sent.enable_search).toBe(true);
    expect(sent.search_options.search_strategy).toBe('agent');
    expect(sent.search_options.enable_source).toBe(true);
    // Must NOT set response_format — Qwen rejects that when enable_search=true.
    expect(sent.response_format).toBeUndefined();
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
    // should not retry on 4xx
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns TimeoutError on AbortError', async () => {
    fetchMock.mockImplementationOnce(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    const result = await callQwen({
      model: 'qwen3-max',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-fake',
      timeoutMs: 1,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.errorClass).toBe('TimeoutError');
  });

  it('returns empty references when search_info is absent', async () => {
    fetchMock.mockResolvedValueOnce(
      successResponse({ contentJson: '{"foo":"bar"}' })
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
    expect(result.searchReferences).toEqual([]);
    expect(result.searchCount).toBe(0);
  });

  it('dedupes references by URL when the same url appears twice', async () => {
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
    expect(result.searchReferences.map((r) => r.url).sort()).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });
});
