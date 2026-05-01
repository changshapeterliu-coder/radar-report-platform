import type {
  EngineError,
  EngineErrorClass,
  EngineSearchReference,
  LoopStage,
} from '../types';
import { stripCodeFences, type ChatMessage } from './openrouter-client';

const QWEN_ENDPOINT =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

/**
 * Retry budget for network flakiness (cross-border Vercel US → dashscope.aliyuncs.com
 * occasionally throws at the TLS / DNS layer). Each retry uses exponential backoff.
 *
 * Retries do NOT apply to 4xx (credits / auth / bad-request) — those are permanent.
 */
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 500;

export interface QwenCallParams {
  /** e.g. 'qwen3-max' or 'qwen3.5-plus'. */
  model: string;
  messages: ChatMessage[];
  apiKey: string;
  /** Hard cap on the whole call including retries. */
  timeoutMs: number;
  /** Engine + stage context for error classification. */
  errorContext: {
    engine: 'gemini' | 'kimi' | 'synthesizer';
    stage?: LoopStage;
    topicIndex?: number;
  };
}

export type QwenResult<T> =
  | {
      ok: true;
      data: T;
      rawContent: string;
      searchReferences: EngineSearchReference[];
      /** Number of distinct web_search invocations Qwen made (from usage). */
      searchCount: number;
    }
  | { ok: false; error: EngineError };

/**
 * Calls Alibaba DashScope (Qwen) via its OpenAI-compatible endpoint, with
 * web search enabled via extra_body.enable_search + search_options.
 *
 * Qwen's search contract (per alibabacloud.com docs):
 *   - enable_search: true
 *   - search_options: { search_strategy: 'agent', enable_source: true }
 *   - Qwen itself runs the multi-round search loop internally; there's no
 *     client-side tool_calls loop (unlike Moonshot). A single HTTP call
 *     returns the final synthesized content.
 *   - Response includes `search_info.search_results[]` with { index, title, url }
 *     for citation extraction.
 *
 * Implementation notes:
 *   - We enforce JSON mode via response_format when allowed (Qwen3-max is; 
 *     some thinking-mode models are not — we pass the flag anyway and fall
 *     back to stripCodeFences on the response).
 *   - Cross-border network retries: 3 attempts with exponential backoff,
 *     only for transient errors (network / timeout / 5xx).
 */
export async function callQwen<T = unknown>(
  params: QwenCallParams
): Promise<QwenResult<T>> {
  const { model, messages, apiKey, timeoutMs, errorContext } = params;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  const body = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    enable_search: true,
    search_options: {
      search_strategy: 'agent',
      enable_source: true,
    },
    response_format: { type: 'json_object' },
  };

  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let response: Response;
      try {
        response = await fetch(QWEN_ENDPOINT, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } catch (err: unknown) {
        const isAbort =
          err instanceof Error && err.name === 'AbortError';
        if (isAbort) {
          return {
            ok: false,
            error: {
              ...errorContext,
              errorClass: 'TimeoutError',
              message: `Qwen TimeoutError: aborted after ${timeoutMs}ms`,
            },
          };
        }
        // Transient network — retry
        if (attempt < MAX_RETRIES) {
          await delay(BACKOFF_BASE_MS * Math.pow(2, attempt));
          continue;
        }
        return {
          ok: false,
          error: {
            ...errorContext,
            errorClass: 'NetworkError',
            message: `Qwen NetworkError after ${MAX_RETRIES + 1} attempts: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        };
      }

      if (!response.ok) {
        const errorClass = classifyHttpStatus(response.status);
        // 5xx → retry; 4xx → fail immediately
        if (response.status >= 500 && attempt < MAX_RETRIES) {
          await delay(BACKOFF_BASE_MS * Math.pow(2, attempt));
          continue;
        }
        let bodyText = '';
        try {
          bodyText = await response.text();
        } catch {
          /* ignore */
        }
        return {
          ok: false,
          error: {
            ...errorContext,
            errorClass,
            httpStatus: response.status,
            message:
              errorClass === 'CreditsExhausted'
                ? `Qwen credits/auth failure (${errorContext.engine}): ${truncate(bodyText, 150)}`
                : `Qwen ${response.status} ${response.statusText}${bodyText ? `: ${truncate(bodyText, 200)}` : ''}`,
          },
        };
      }

      // Successful HTTP response — parse + return.
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (err: unknown) {
        return {
          ok: false,
          error: {
            ...errorContext,
            errorClass: 'MalformedResponse',
            message: `Qwen envelope is not JSON: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        };
      }

      const rawContent = extractAssistantContent(payload);
      if (rawContent === null) {
        return {
          ok: false,
          error: {
            ...errorContext,
            errorClass: 'MalformedResponse',
            message: 'Qwen response had no choices[0].message.content',
          },
        };
      }

      const cleaned = stripCodeFences(rawContent);
      let parsed: T;
      try {
        parsed = JSON.parse(cleaned) as T;
      } catch (err: unknown) {
        return {
          ok: false,
          error: {
            ...errorContext,
            errorClass: 'MalformedResponse',
            message: `Qwen content is not valid JSON: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        };
      }

      const searchReferences = extractSearchReferences(
        payload,
        errorContext.stage ?? 'hot-radar-scan'
      );
      const searchCount = extractSearchCount(payload);

      return {
        ok: true,
        data: parsed,
        rawContent: cleaned,
        searchReferences,
        searchCount,
      };
    }

    // Should not reach here; loop always returns.
    return {
      ok: false,
      error: {
        ...errorContext,
        errorClass: 'ServerError',
        message: 'Qwen retry loop exited unexpectedly',
      },
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// ──────────────────────────────────────────────────────
// Response parsing
// ──────────────────────────────────────────────────────

function extractAssistantContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const choices = (payload as { choices?: unknown[] }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  return typeof content === 'string' ? content : null;
}

/**
 * Qwen DashScope returns search sources in two possible locations depending
 * on protocol variant:
 *   - OpenAI-compatible: choices[0].message.search_info.search_results
 *   - native DashScope:  output.search_info.search_results
 *
 * We probe both to stay robust across minor API changes.
 */
function extractSearchReferences(
  payload: unknown,
  stage: LoopStage
): EngineSearchReference[] {
  if (!payload || typeof payload !== 'object') return [];
  const refs: EngineSearchReference[] = [];

  const candidateArrays: unknown[] = [];

  // OpenAI-compatible shape
  const oaiChoices = (payload as { choices?: unknown[] }).choices;
  if (Array.isArray(oaiChoices) && oaiChoices[0]) {
    const msg = (oaiChoices[0] as { message?: Record<string, unknown> }).message;
    const si = msg?.search_info;
    if (si && typeof si === 'object') {
      const arr = (si as { search_results?: unknown }).search_results;
      if (Array.isArray(arr)) candidateArrays.push(...arr);
    }
  }

  // Native DashScope shape
  const output = (payload as { output?: unknown }).output;
  if (output && typeof output === 'object') {
    const si = (output as { search_info?: unknown }).search_info;
    if (si && typeof si === 'object') {
      const arr = (si as { search_results?: unknown }).search_results;
      if (Array.isArray(arr)) candidateArrays.push(...arr);
    }
  }

  const seen = new Set<string>();
  for (const raw of candidateArrays) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const url = typeof o.url === 'string' ? o.url : null;
    if (!url || !url.startsWith('http')) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    refs.push({
      url,
      title: typeof o.title === 'string' ? o.title : undefined,
      stage,
      provider: 'qwen',
      snippet:
        typeof o.snippet === 'string'
          ? truncate(o.snippet, 200)
          : undefined,
    });
  }
  return refs;
}

/**
 * Extracts count of web_search tool invocations from usage.plugins.search.count
 * (native DashScope) or falls back to the length of search_results.
 */
function extractSearchCount(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0;

  // Native shape: usage.plugins.search.count
  const usage = (payload as { usage?: unknown }).usage;
  if (usage && typeof usage === 'object') {
    const plugins = (usage as { plugins?: unknown }).plugins;
    if (plugins && typeof plugins === 'object') {
      const search = (plugins as { search?: unknown }).search;
      if (search && typeof search === 'object') {
        const count = (search as { count?: unknown }).count;
        if (typeof count === 'number') return count;
      }
    }
  }

  // Fallback: count unique URLs we extracted
  const refs = extractSearchReferences(payload, 'hot-radar-scan');
  return refs.length;
}

function classifyHttpStatus(status: number): EngineErrorClass {
  // Alibaba-specific: 401 = bad key, 403 = not authorized, 402 = payment,
  // 429 = rate limit. Treat auth/billing as CreditsExhausted for operator clarity.
  if (status === 401 || status === 402 || status === 403) return 'CreditsExhausted';
  if (status === 429) return 'RateLimited';
  if (status >= 500 && status < 600) return 'ServerError';
  return 'ServerError';
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
