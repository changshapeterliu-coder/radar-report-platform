import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { callZai } from '../zai-client';

// ─────────────────────────────────────────────────────────
// Response builders — mirror real z.ai response envelope shape
// (choices[0].message.content as string; top-level web_search[] array
// with { title, link, publish_date, content, media, refer, icon })
// ─────────────────────────────────────────────────────────

interface WebSearchEntry {
  title: string;
  link: string;
  publish_date?: string;
  content?: string;
  media?: string;
  refer?: string;
  icon?: string;
}

function successResponse(opts: {
  contentJson: string;
  webSearch?: WebSearchEntry[];
  finishReason?: string;
}): Response {
  const body: Record<string, unknown> = {
    id: 'chatcmpl-test',
    model: 'glm-4.6',
    created: 1_770_000_000,
    choices: [
      {
        index: 0,
        finish_reason: opts.finishReason ?? 'stop',
        message: {
          role: 'assistant',
          content: opts.contentJson,
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };
  if (opts.webSearch) {
    body.web_search = opts.webSearch;
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

describe('callZai', () => {
  const fetchMock = vi.fn<(url: unknown, init?: unknown) => Promise<Response>>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 1
  it('successful JSON parse: happy path returns ok:true with data and refs', async () => {
    fetchMock.mockResolvedValueOnce(
      successResponse({
        contentJson: JSON.stringify({ foo: 'bar', count: 3 }),
        webSearch: [
          {
            title: '跨境电商合规政策',
            link: 'https://www.cifnews.com/article/12345',
            publish_date: '2026-04-28',
            content: '本周跨境卖家遇到的新合规要求...',
            media: '雨果网',
            refer: 'ref_1',
          },
          {
            title: '亚马逊账户健康讨论',
            link: 'https://www.amz123.com/thread/999',
            publish_date: '',
            content: '卖家反馈二审资料被拒...',
          },
        ],
      })
    );

    const result = await callZai<{ foo: string; count: number }>({
      model: 'glm-4.6',
      messages: [
        { role: 'system', content: 'you are GLM' },
        { role: 'user', content: '搜本周话题，返回 JSON' },
      ],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      jsonMode: true,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.foo).toBe('bar');
    expect(result.data.count).toBe(3);
    expect(result.searchCount).toBe(2);
    expect(result.searchReferences).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 2
  it('web_search tool call round-trip: request and response shapes match design', async () => {
    fetchMock.mockResolvedValueOnce(
      successResponse({
        contentJson: '{}',
        webSearch: [
          {
            title: 'A',
            link: 'https://example.com/a',
            publish_date: '2026-04-01',
            content: 'Full article body about compliance',
          },
        ],
      })
    );

    await callZai({
      model: 'glm-4.6',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      jsonMode: true,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.z.ai/api/paas/v4/chat/completions');

    const sent = JSON.parse((init as { body: string }).body) as {
      model: string;
      thinking: { type: string };
      tools: Array<{
        type: string;
        web_search: { enable: string; search_result: string };
      }>;
      response_format?: { type: string };
    };
    expect(sent.model).toBe('glm-4.6');
    expect(sent.thinking.type).toBe('disabled');
    expect(sent.tools).toHaveLength(1);
    expect(sent.tools[0].type).toBe('web_search');
    // Critical: 'True' / 'False' strings, not booleans.
    expect(sent.tools[0].web_search.enable).toBe('True');
    expect(sent.tools[0].web_search.search_result).toBe('True');
    expect(sent.response_format?.type).toBe('json_object');

    // Second fetch call NOT made — this is single-call design.
    // (Already asserted toHaveBeenCalledTimes above.)
  });

  // 3
  it('search_recency_filter and content_size are forwarded', async () => {
    fetchMock.mockResolvedValueOnce(
      successResponse({ contentJson: '{}' })
    );

    await callZai({
      model: 'glm-4.6',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      jsonMode: true,
      searchRecency: 'oneMonth',
      contentSize: 'high',
      errorContext: { engine: 'kimi', stage: 'deep-dive', topicIndex: 2 },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse((init as { body: string }).body) as {
      tools: Array<{
        web_search: {
          search_recency_filter?: string;
          content_size?: string;
        };
      }>;
    };
    expect(sent.tools[0].web_search.search_recency_filter).toBe('oneMonth');
    expect(sent.tools[0].web_search.content_size).toBe('high');
  });

  // 4
  it('401 is classified as CreditsExhausted without retry', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, 'Invalid API key'));

    const result = await callZai({
      model: 'glm-4.6',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-bad',
      timeoutMs: 10_000,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.errorClass).toBe('CreditsExhausted');
    expect(result.error.httpStatus).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 5
  it('429 is classified as RateLimited', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(429, 'Too many requests'));

    const result = await callZai({
      model: 'glm-4.6',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.errorClass).toBe('RateLimited');
    expect(result.error.httpStatus).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 6
  it('transient 500 is retried once and succeeds on second attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(500, 'upstream down'))
      .mockResolvedValueOnce(
        successResponse({ contentJson: '{"ok": true}' })
      );

    const result = await callZai<{ ok: boolean }>({
      model: 'glm-4.6',
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

  // 7
  it('malformed response body is classified as MalformedResponse', async () => {
    fetchMock.mockResolvedValueOnce(
      successResponse({ contentJson: 'not valid json at all' })
    );

    const result = await callZai({
      model: 'glm-4.6',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      jsonMode: true,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.errorClass).toBe('MalformedResponse');
  });

  // 8
  it('abort error is classified as TimeoutError', async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException('aborted', 'AbortError')
    );

    const result = await callZai({
      model: 'glm-4.6',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.errorClass).toBe('TimeoutError');
    // AbortError does NOT retry (we return immediately).
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 9
  it('search references are deduped by URL', async () => {
    fetchMock.mockResolvedValueOnce(
      successResponse({
        contentJson: '{}',
        webSearch: [
          { title: 'A', link: 'https://example.com/a' },
          { title: 'A-dup', link: 'https://example.com/a' },
          { title: 'B', link: 'https://example.com/b' },
        ],
      })
    );

    const result = await callZai({
      model: 'glm-4.6',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      jsonMode: true,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.searchReferences).toHaveLength(2);
    expect(result.searchReferences[0].provider).toBe('zai');
    // Verify the link→url mapping
    expect(result.searchReferences.map((r) => r.url).sort()).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  // 10 — regression guard for z.ai's empty-link runtime behavior.
  // Discovered 2026-05-02 via live probe: z.ai returns `link: ""` on real
  // search results, but `refer: "ref_N"` is populated. Parser must fall back
  // to `zai-ref://ref_N` so refs aren't silently dropped.
  it('falls back to refer when link is empty (real z.ai behavior)', async () => {
    fetchMock.mockResolvedValueOnce(
      successResponse({
        contentJson: '{}',
        webSearch: [
          {
            title: '跨境电商合规政策',
            link: '', // empty — real z.ai runtime behavior
            refer: 'ref_1',
            publish_date: '2026-04-28',
            content: '本周跨境卖家的合规讨论...',
          },
          {
            title: '账户健康讨论',
            link: '',
            refer: 'ref_2',
            content: '...',
          },
        ],
      })
    );

    const result = await callZai({
      model: 'glm-4.6',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      jsonMode: true,
      errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.searchReferences).toHaveLength(2);
    expect(result.searchReferences[0].url).toBe('zai-ref://ref_1');
    expect(result.searchReferences[1].url).toBe('zai-ref://ref_2');
    expect(result.searchReferences[0].title).toBe('跨境电商合规政策');
    expect(result.searchReferences[0].snippet).toContain('本周');
  });
});
