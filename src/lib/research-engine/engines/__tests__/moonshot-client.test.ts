import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { callMoonshot } from '../moonshot-client';

// ─────────────────────────────────────────────────────────────
// Helpers — build Moonshot-shaped API responses
// ─────────────────────────────────────────────────────────────

function toolCallsResponse(opts: {
  toolCallId: string;
  argsJson: string;
}): Response {
  const body = {
    id: 'cmpl-test',
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: opts.toolCallId,
              type: 'builtin_function',
              function: {
                name: '$web_search',
                arguments: opts.argsJson,
              },
            },
          ],
        },
      },
    ],
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function terminalResponse(contentJson: string): Response {
  const body = {
    id: 'cmpl-test',
    choices: [
      {
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: contentJson,
        },
      },
    ],
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function httpErrorResponse(status: number, body = 'error'): Response {
  return new Response(body, { status, statusText: 'err' });
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('callMoonshot', () => {
  const fetchMock = vi.fn<(url: unknown, init?: unknown) => Promise<Response>>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('completes a tool_calls loop and returns parsed JSON + collected references', async () => {
    // Round 1: assistant asks $web_search with args containing 2 search results.
    const searchArgs = JSON.stringify({
      query: '亚马逊 封号',
      search_result: [
        {
          url: 'https://www.wearesellers.com/q/12345',
          title: '最近又一批账号被封',
          date: '2026-04-22',
          snippet: '卖家讨论…',
        },
        {
          url: 'https://www.cifnews.com/article/99999',
          title: '雨果网政策解读',
        },
      ],
      usage: { total_tokens: 12345 },
    });

    // Round 2: assistant returns terminal JSON content.
    const finalJson = JSON.stringify({
      account_health_topics: [{ topic: '测试 topic', voice_volume: 5 }],
      listing_topics: [],
      tool_feedback_items: [],
    });

    fetchMock
      .mockResolvedValueOnce(
        toolCallsResponse({ toolCallId: 'call_1', argsJson: searchArgs })
      )
      .mockResolvedValueOnce(terminalResponse(finalJson));

    const result = await callMoonshot<{
      account_health_topics: unknown[];
    }>({
      model: 'kimi-k2.6',
      messages: [
        { role: 'system', content: 'you are Kimi.' },
        { role: 'user', content: 'search stuff' },
      ],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      jsonMode: true,
      errorContext: { engine: 'gemini', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.account_health_topics).toHaveLength(1);
    expect(result.searchCount).toBe(1);
    expect(result.searchReferences).toHaveLength(2);

    const urls = result.searchReferences.map((r) => r.url).sort();
    expect(urls).toEqual([
      'https://www.cifnews.com/article/99999',
      'https://www.wearesellers.com/q/12345',
    ]);

    const datedRef = result.searchReferences.find(
      (r) => r.url === 'https://www.wearesellers.com/q/12345'
    );
    expect(datedRef?.published_date).toBe('2026-04-22');
    expect(datedRef?.provider).toBe('moonshot');
    expect(datedRef?.stage).toBe('hot-radar-scan');

    // Ensure two HTTP calls were made (tool_calls round + terminal round).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns TimeoutError when fetch is aborted', async () => {
    // Simulate the AbortController firing inside fetch.
    fetchMock.mockImplementationOnce(() => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    const result = await callMoonshot({
      model: 'kimi-k2.6',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-fake',
      timeoutMs: 1, // effectively instant
      errorContext: { engine: 'gemini', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.errorClass).toBe('TimeoutError');
    expect(result.error.engine).toBe('gemini');
    expect(result.error.stage).toBe('hot-radar-scan');
  });

  it('classifies 401 as CreditsExhausted', async () => {
    fetchMock.mockResolvedValueOnce(httpErrorResponse(401, 'Invalid API key'));

    const result = await callMoonshot({
      model: 'kimi-k2.6',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-bad',
      timeoutMs: 10_000,
      errorContext: { engine: 'gemini', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.errorClass).toBe('CreditsExhausted');
    expect(result.error.httpStatus).toBe(401);
  });

  it('returns MalformedResponse when terminal content is not valid JSON', async () => {
    fetchMock.mockResolvedValueOnce(terminalResponse('not json at all'));

    const result = await callMoonshot({
      model: 'kimi-k2.6',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      errorContext: { engine: 'gemini', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.errorClass).toBe('MalformedResponse');
    expect(result.error.message).toMatch(/not valid JSON/);
  });

  it('strips markdown code fences from terminal JSON content', async () => {
    const fenced = '```json\n{"ok": true}\n```';
    fetchMock.mockResolvedValueOnce(terminalResponse(fenced));

    const result = await callMoonshot<{ ok: boolean }>({
      model: 'kimi-k2.6',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      errorContext: { engine: 'gemini', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.ok).toBe(true);
  });

  it('sends builtin_function tool declaration + disabled thinking in the request body', async () => {
    fetchMock.mockResolvedValueOnce(terminalResponse('{}'));

    await callMoonshot({
      model: 'kimi-k2.6',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      errorContext: { engine: 'gemini', stage: 'hot-radar-scan' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse((init as { body: string }).body) as {
      model: string;
      tools: Array<{ type: string; function: { name: string } }>;
      thinking: { type: string };
    };
    expect(sentBody.model).toBe('kimi-k2.6');
    expect(sentBody.tools[0]).toEqual({
      type: 'builtin_function',
      function: { name: '$web_search' },
    });
    expect(sentBody.thinking).toEqual({ type: 'disabled' });
  });

  it('bails with MalformedResponse if tool_calls loop exceeds max iterations', async () => {
    // Every response is tool_calls → never terminates.
    const endlessArgs = JSON.stringify({ query: 'x', search_result: [] });
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        toolCallsResponse({ toolCallId: 'call_x', argsJson: endlessArgs })
      )
    );

    const result = await callMoonshot({
      model: 'kimi-k2.6',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-fake',
      timeoutMs: 10_000,
      errorContext: { engine: 'gemini', stage: 'hot-radar-scan' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.errorClass).toBe('MalformedResponse');
    expect(result.error.message).toMatch(/exceeded .* tool_calls rounds/);
  });
});
