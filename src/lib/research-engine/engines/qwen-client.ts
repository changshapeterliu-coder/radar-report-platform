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
 * Retries do NOT apply to 4xx (credits / auth / bad-request) — those are permanent.
 */
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 500;

/**
 * How much of the total caller-supplied timeout the search step consumes.
 * Remainder goes to the JSON structuring step. Search is heavier (actually
 * hits web), structuring is pure LLM reasoning on a prepared buffer.
 */
const SEARCH_TIMEOUT_FRACTION = 0.65;

export interface QwenCallParams {
  /** e.g. 'qwen3-max' or 'qwen3.5-plus'. */
  model: string;
  messages: ChatMessage[];
  apiKey: string;
  /** Hard cap on the whole two-step flow. */
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
 * Calls Alibaba DashScope (Qwen) with web search enabled, returning strict JSON.
 *
 * ── Two-step flow (decouples search from structured output) ──
 * DashScope rejects `response_format: json_object` when `enable_search: true`
 * ("The current model does not support the json response format when using
 * search" — InternalError.Algo.InvalidParameter). We can't use the two
 * features in a single HTTP call.
 *
 * Workaround:
 *   Step 1  enable_search=true   → natural-language digest of search results,
 *                                  search_info.search_results[] collected here
 *   Step 2  response_format=json → model reformats the Step-1 digest into the
 *                                  JSON shape requested by the original prompt
 *
 * Both steps use the same conversation context (the caller's messages). The
 * JSON prompt hint is preserved in Step 1's system message so the model's
 * search output is already close to the target schema — Step 2 just
 * enforces strict JSON formatting.
 *
 * ── Qwen's search contract (per alibabacloud.com docs) ──
 *   enable_search: true
 *   search_options: { search_strategy: 'agent', enable_source: true }
 *   Qwen runs the multi-round search loop internally (no client tool_calls
 *   loop like Moonshot). Response includes search_info.search_results[]
 *   with { index, title, url, snippet? }.
 *
 * ── Cross-border resilience ──
 * Vercel US → dashscope.aliyuncs.com can flake at TLS / DNS. Retries
 * (2× exponential backoff) apply only to network errors + HTTP 5xx;
 * 4xx fails immediately.
 */
export async function callQwen<T = unknown>(
  params: QwenCallParams
): Promise<QwenResult<T>> {
  const { model, messages, apiKey, timeoutMs, errorContext } = params;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // ── Step 1: Search + natural-language output ──
    const step1TimeoutMs = Math.floor(timeoutMs * SEARCH_TIMEOUT_FRACTION);
    const step1 = await qwenHttpCall({
      endpoint: QWEN_ENDPOINT,
      model,
      apiKey,
      signal: controller.signal,
      body: {
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        enable_search: true,
        search_options: {
          search_strategy: 'agent',
          enable_source: true,
        },
        // DashScope rejects the 3-way combination `enable_search + thinking mode
        // + non-streaming` with HTTP 400 "Non-streaming mode does not support
        // Web Search in thinking mode".
        //
        // Qwen models (qwen-plus, qwen3-max, qwen3.5-*, qwen3.6-*) return
        // thinking-mode-on *at runtime* unless explicitly overridden, even when
        // the official docs say the model "defaults to thinking off". This is
        // reproducible and widely reported in the community (Spring AI issue,
        // modelscope issue #948, etc.). We must always set enable_thinking=false
        // on every non-streaming search call.
        enable_thinking: false,
        // Note: no response_format — incompatible with enable_search.
      },
      retryBudget: MAX_RETRIES,
      errorContext: { ...errorContext, step: 'search' },
      stepTimeoutMs: step1TimeoutMs,
    });
    if (!step1.ok) return step1;

    const searchReferences = extractSearchReferences(
      step1.payload,
      errorContext.stage ?? 'hot-radar-scan'
    );
    const searchCount = extractSearchCount(step1.payload);
    const step1Content = extractAssistantContent(step1.payload);
    if (step1Content === null) {
      return {
        ok: false,
        error: {
          ...errorContext,
          errorClass: 'MalformedResponse',
          message: 'Qwen step-1 response had no choices[0].message.content',
        },
      };
    }

    // Fast-path: if Step 1 already returned strict JSON (model obeyed the
    // prompt), skip Step 2 to save a round-trip + tokens.
    const fastPath = tryParseStrictJson<T>(step1Content);
    if (fastPath !== null) {
      return {
        ok: true,
        data: fastPath,
        rawContent: stripCodeFences(step1Content),
        searchReferences,
        searchCount,
      };
    }

    // ── Step 2: Structure the natural-language output into strict JSON ──
    // Reconstruct the original prompt's JSON requirements from the caller's
    // system message(s). We ask Qwen to re-emit the content in strict JSON.
    const originalSystem = messages.find((m) => m.role === 'system')?.content ?? '';
    const structureSystem = `You are a JSON formatter. Reformat the provided text into strict JSON matching the schema described in the original instructions below. Return ONLY the JSON object — no prose, no markdown fences, no commentary.

=== ORIGINAL INSTRUCTIONS (reference for schema) ===
${originalSystem}
=== END ORIGINAL INSTRUCTIONS ===`;

    const step2 = await qwenHttpCall({
      endpoint: QWEN_ENDPOINT,
      model,
      apiKey,
      signal: controller.signal,
      body: {
        model,
        messages: [
          { role: 'system', content: structureSystem },
          {
            role: 'user',
            content: `Reformat this content into strict JSON matching the schema. Return ONLY valid JSON:\n\n${step1Content}`,
          },
        ],
        // Step 2 has NO enable_search → response_format works.
        response_format: { type: 'json_object' },
      },
      retryBudget: MAX_RETRIES,
      errorContext: { ...errorContext, step: 'structure' },
      stepTimeoutMs: timeoutMs - step1TimeoutMs,
    });
    if (!step2.ok) return step2;

    const step2Content = extractAssistantContent(step2.payload);
    if (step2Content === null) {
      return {
        ok: false,
        error: {
          ...errorContext,
          errorClass: 'MalformedResponse',
          message: 'Qwen step-2 response had no choices[0].message.content',
        },
      };
    }

    const cleaned = stripCodeFences(step2Content);
    let parsed: T;
    try {
      parsed = JSON.parse(cleaned) as T;
    } catch (err: unknown) {
      return {
        ok: false,
        error: {
          ...errorContext,
          errorClass: 'MalformedResponse',
          message: `Qwen step-2 content is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }

    return {
      ok: true,
      data: parsed,
      rawContent: cleaned,
      searchReferences,
      searchCount,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// ──────────────────────────────────────────────────────
// Shared HTTP call helper (used by Step 1 and Step 2)
// ──────────────────────────────────────────────────────

interface QwenHttpParams {
  endpoint: string;
  model: string;
  apiKey: string;
  signal: AbortSignal;
  body: Record<string, unknown>;
  retryBudget: number;
  errorContext: {
    engine: 'gemini' | 'kimi' | 'synthesizer';
    stage?: LoopStage;
    topicIndex?: number;
    /** Which step of the two-step flow this call belongs to. */
    step: 'search' | 'structure';
  };
  stepTimeoutMs: number;
}

type QwenHttpResult =
  | { ok: true; payload: unknown }
  | { ok: false; error: EngineError };

async function qwenHttpCall(params: QwenHttpParams): Promise<QwenHttpResult> {
  const { endpoint, apiKey, signal, body, retryBudget, errorContext } = params;

  for (let attempt = 0; attempt <= retryBudget; attempt++) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (isAbort) {
        return {
          ok: false,
          error: {
            engine: errorContext.engine,
            stage: errorContext.stage,
            topicIndex: errorContext.topicIndex,
            errorClass: 'TimeoutError',
            message: `Qwen ${errorContext.step} step aborted (caller timeout exhausted)`,
          },
        };
      }
      if (attempt < retryBudget) {
        await delay(BACKOFF_BASE_MS * Math.pow(2, attempt));
        continue;
      }
      return {
        ok: false,
        error: {
          engine: errorContext.engine,
          stage: errorContext.stage,
          topicIndex: errorContext.topicIndex,
          errorClass: 'NetworkError',
          message: `Qwen ${errorContext.step} NetworkError after ${retryBudget + 1} attempts: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }

    if (!response.ok) {
      const errorClass = classifyHttpStatus(response.status);
      if (response.status >= 500 && attempt < retryBudget) {
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
          engine: errorContext.engine,
          stage: errorContext.stage,
          topicIndex: errorContext.topicIndex,
          errorClass,
          httpStatus: response.status,
          message:
            errorClass === 'CreditsExhausted'
              ? `Qwen ${errorContext.step} credits/auth failure: ${truncate(bodyText, 150)}`
              : `Qwen ${errorContext.step} ${response.status} ${response.statusText}${bodyText ? `: ${truncate(bodyText, 200)}` : ''}`,
        },
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err: unknown) {
      return {
        ok: false,
        error: {
          engine: errorContext.engine,
          stage: errorContext.stage,
          topicIndex: errorContext.topicIndex,
          errorClass: 'MalformedResponse',
          message: `Qwen ${errorContext.step} envelope is not JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
    return { ok: true, payload };
  }

  // Unreachable under normal control flow.
  return {
    ok: false,
    error: {
      engine: errorContext.engine,
      stage: errorContext.stage,
      topicIndex: errorContext.topicIndex,
      errorClass: 'ServerError',
      message: `Qwen ${errorContext.step} retry loop exited unexpectedly`,
    },
  };
}

// ──────────────────────────────────────────────────────
// Response parsing helpers
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
 * Attempts strict JSON parse after stripping code fences. Returns null on
 * failure rather than throwing — used by the fast-path in callQwen to
 * detect whether Step 1 already returned valid JSON.
 */
function tryParseStrictJson<T>(content: string): T | null {
  try {
    return JSON.parse(stripCodeFences(content)) as T;
  } catch {
    return null;
  }
}

/**
 * Qwen DashScope returns search sources in two possible locations:
 *   - OpenAI-compatible: choices[0].message.search_info.search_results
 *   - native DashScope:  output.search_info.search_results
 * We probe both to stay robust across API protocol variants.
 */
function extractSearchReferences(
  payload: unknown,
  stage: LoopStage
): EngineSearchReference[] {
  if (!payload || typeof payload !== 'object') return [];
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

  const refs: EngineSearchReference[] = [];
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

  // Fallback: count unique URLs
  const refs = extractSearchReferences(payload, 'hot-radar-scan');
  return refs.length;
}

function classifyHttpStatus(status: number): EngineErrorClass {
  // Alibaba-specific: 401 = bad key, 402 = payment, 403 = forbidden,
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
