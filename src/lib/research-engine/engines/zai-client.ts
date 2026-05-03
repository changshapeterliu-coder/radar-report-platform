import type {
  EngineError,
  EngineErrorClass,
  EngineSearchReference,
  LoopStage,
} from '../types';
import { stripCodeFences, type ChatMessage } from './openrouter-client';

/**
 * Zhipu AI GLM client for Engine B Stage 1 / Stage 2 research.
 *
 * Endpoint: OpenAI-compatible Chat Completions at z.ai.
 *   https://api.z.ai/api/paas/v4/chat/completions
 *
 * Model: glm-4.6 — Zhipu's reasoning + tool-use flagship (released 2025-09;
 * 6+ months production hardening, positioned as a "search-based agents"
 * workhorse per Zhipu's model card).
 *
 * The novelty that this module relies on (vs the Moonshot / Qwen clients):
 *
 *   1. Single HTTP call combines:
 *        - `thinking: { type: 'disabled' }`       (explicit opt-out)
 *        - `response_format: { type: 'json_object' }`
 *        - `tools: [{ type: 'web_search', ... }]`
 *      GLM-4.6 has no DashScope-style restriction forbidding response_format
 *      while web_search is enabled — a single round-trip covers both.
 *
 *   2. `enable` and `search_result` inside the web_search tool object are
 *      string literals `'True'` / `'False'`, NOT booleans. Per z.ai docs:
 *        https://docs.z.ai/guides/tools/web-search
 *
 *   3. Search references arrive at the TOP LEVEL of the response body as
 *      `web_search[]`, NOT nested inside the choice message. Each entry uses
 *      `link` (not `url`), and `publish_date` may be an empty string.
 *
 *   4. `thinking: { type: 'disabled' }` must be set explicitly — GLM-4.6 is a
 *      hybrid thinking model that defaults thinking ON when unspecified.
 *      Leaving it default triggers the same class of failure that killed
 *      Qwen's integration (thinking + non-streaming + search conflict).
 *
 * Design doc: .kiro/specs/engine-b-glm-replacement/design.md §5, §6.
 */

const ZAI_ENDPOINT = 'https://api.z.ai/api/paas/v4/chat/completions';

/**
 * Retry budget for cross-border network flakiness (Vercel US → api.z.ai in CN).
 * Applied to 5xx server errors and fetch-layer NetworkError. 4xx (auth /
 * rate-limit / bad-request) fail immediately with no retry.
 */
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 500;

export interface ZaiCallParams {
  /** GLM model id, e.g. 'glm-4.6'. */
  model: string;
  messages: ChatMessage[];
  apiKey: string;
  /** Hard cap on the single HTTP call. Stage-level (240s / 60s / 90s). */
  timeoutMs: number;
  /** If true, include `response_format: { type: 'json_object' }`. */
  jsonMode?: boolean;
  /**
   * If false, omit the `tools: [{ type: 'web_search', ... }]` field from the
   * request body — the call becomes a pure LLM chat without web search. This
   * is required by the Daily canonicalization step (reasoning over a provided
   * topic + canonical dictionary, no external search needed). Default: true
   * (preserves historical Engine B / weekly-pipeline behaviour).
   *
   * When false: `searchRecency` and `contentSize` are ignored; no
   * `web_search[]` entries will appear in the response envelope, and
   * `searchReferences` in the result will always be the empty array.
   */
  enableWebSearch?: boolean;
  /**
   * OpenAI-compatible `tool_choice` parameter for the z.ai chat-completions
   * endpoint. Controls whether GLM must call a tool or may skip it.
   *   - `'auto'` (default) → model decides. **Known issue**: on daily-scan
   *     prompts GLM-4.6 frequently bypasses web_search and hallucinates
   *     topics from training data (observed 2026-05-03 production run).
   *   - `'required'` → model must call at least one tool before responding.
   *     Recommended when you need real search results, not training knowledge.
   *
   * Ignored when `enableWebSearch` is false (no tools to choose from).
   *
   * Undefined → omit the field (GLM default behaviour, equivalent to 'auto').
   */
  toolChoice?: 'auto' | 'required';
  /**
   * Passed through to the web_search tool's search_recency_filter field.
   * Undefined → omit field (GLM default: noLimit).
   * Ignored when `enableWebSearch` is false.
   */
  searchRecency?: 'noLimit' | 'oneDay' | 'oneWeek' | 'oneMonth' | 'oneYear';
  /**
   * Passed through to the web_search tool's content_size field.
   * Undefined → omit field (GLM default: medium).
   * Ignored when `enableWebSearch` is false.
   */
  contentSize?: 'low' | 'medium' | 'high';
  errorContext: {
    engine: 'gemini' | 'kimi' | 'synthesizer';
    stage?: LoopStage;
    topicIndex?: number;
  };
}

export type ZaiResult<T> =
  | {
      ok: true;
      data: T;
      rawContent: string;
      searchReferences: EngineSearchReference[];
      searchCount: number;
    }
  | { ok: false; error: EngineError };

/**
 * Calls Zhipu GLM via z.ai's OpenAI-compatible endpoint with web_search
 * enabled and strict JSON output in a single round-trip.
 */
export async function callZai<T = unknown>(
  params: ZaiCallParams
): Promise<ZaiResult<T>> {
  const {
    model,
    messages,
    apiKey,
    timeoutMs,
    jsonMode,
    enableWebSearch = true,
    toolChoice,
    searchRecency,
    contentSize,
    errorContext,
  } = params;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      thinking: { type: 'disabled' },
      temperature: 0.3,
      max_tokens: 8192,
    };

    if (enableWebSearch) {
      // Build the web_search tool config. Note the string 'True' / 'False'
      // convention per z.ai docs — booleans are rejected.
      const webSearchConfig: Record<string, string> = {
        enable: 'True',
        search_result: 'True',
      };
      if (searchRecency) {
        webSearchConfig.search_recency_filter = searchRecency;
      }
      if (contentSize) {
        webSearchConfig.content_size = contentSize;
      }
      body.tools = [
        {
          type: 'web_search',
          web_search: webSearchConfig,
        },
      ];
      // `tool_choice` only meaningful when tools are present. Pass through
      // when caller requested a specific policy; otherwise omit (GLM default).
      if (toolChoice) {
        body.tool_choice = toolChoice;
      }
    }
    // When enableWebSearch is false, `tools` is omitted entirely — the call
    // becomes a pure LLM chat. searchRecency / contentSize / toolChoice
    // are all ignored.

    if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    // Retry loop for 5xx + NetworkError. 4xx + malformed fail fast.
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let response: Response;
      try {
        response = await fetch(ZAI_ENDPOINT, {
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
          !!err &&
          typeof err === 'object' &&
          (err as { name?: unknown }).name === 'AbortError';
        if (isAbort) {
          return {
            ok: false,
            error: {
              ...errorContext,
              errorClass: 'TimeoutError',
              message: `Zhipu TimeoutError: ${
                err instanceof Error ? err.message : String(err)
              }`,
            },
          };
        }
        if (attempt < MAX_RETRIES) {
          await delay(BACKOFF_BASE_MS * Math.pow(2, attempt));
          continue;
        }
        return {
          ok: false,
          error: {
            ...errorContext,
            errorClass: 'NetworkError',
            message: `Zhipu NetworkError after ${MAX_RETRIES + 1} attempts: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        };
      }

      if (!response.ok) {
        const errorClass = classifyHttpStatus(response.status);
        // Only 5xx retries; 4xx fail immediately.
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
                ? `Zhipu credits/auth failure (${response.status}): ${truncate(bodyText, 150)}`
                : `Zhipu ${response.status} ${response.statusText}${bodyText ? `: ${truncate(bodyText, 200)}` : ''}`,
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
            ...errorContext,
            errorClass: 'MalformedResponse',
            message: `Zhipu envelope is not JSON: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
      }

      const choice = extractFirstChoice(payload);
      if (!choice) {
        return {
          ok: false,
          error: {
            ...errorContext,
            errorClass: 'MalformedResponse',
            message: 'Zhipu response had no choices[0]',
          },
        };
      }

      // Single-call design: finish_reason should be 'stop' (or any non-tool_calls
      // terminal value). tool_calls means the model is asking for a further
      // round we don't support — classify as malformed.
      if (choice.finishReason === 'tool_calls') {
        return {
          ok: false,
          error: {
            ...errorContext,
            errorClass: 'MalformedResponse',
            message:
              'Zhipu returned finish_reason=tool_calls; single-call contract expects web_search resolved within one turn',
          },
        };
      }

      if (typeof choice.content !== 'string' || choice.content.length === 0) {
        return {
          ok: false,
          error: {
            ...errorContext,
            errorClass: 'MalformedResponse',
            message: 'Zhipu choices[0].message.content is missing or empty',
          },
        };
      }

      const cleaned = stripCodeFences(choice.content);
      let parsed: T;
      try {
        parsed = JSON.parse(cleaned) as T;
      } catch (err: unknown) {
        return {
          ok: false,
          error: {
            ...errorContext,
            errorClass: 'MalformedResponse',
            message: `Zhipu content is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
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

    // Unreachable under normal control flow — retry loop always returns.
    return {
      ok: false,
      error: {
        ...errorContext,
        errorClass: 'ServerError',
        message: 'Zhipu retry loop exited unexpectedly',
      },
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// ──────────────────────────────────────────────────────
// Response parsing helpers
// ──────────────────────────────────────────────────────

interface ChoiceSlice {
  finishReason: string;
  content: string | null;
}

function extractFirstChoice(payload: unknown): ChoiceSlice | null {
  if (!payload || typeof payload !== 'object') return null;
  const choices = (payload as { choices?: unknown[] }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as
    | { finish_reason?: unknown; message?: unknown }
    | undefined;
  if (!first || typeof first !== 'object') return null;
  const finishReason =
    typeof first.finish_reason === 'string' ? first.finish_reason : 'stop';
  const messageRaw = first.message as Record<string, unknown> | undefined;
  const content =
    messageRaw && typeof messageRaw.content === 'string'
      ? messageRaw.content
      : null;
  return { finishReason, content };
}

/**
 * Extracts web_search[] from the TOP LEVEL of the response envelope (GLM's
 * documented shape). Each entry: { title, link, publish_date, content, media,
 * refer, icon }. Mapped to EngineSearchReference with provider:'zai'.
 *
 * URL resolution order (z.ai's `link` is often empty string at runtime,
 * even though docs document it as the URL field — discovered via probe
 * script on 2026-05-02):
 *   1. `link` if non-empty and looks like http(s)
 *   2. `refer` (e.g. "ref_1") prefixed with `zai-ref://` as a stable
 *      opaque identifier — satisfies b_refs dedup + downstream count
 *      gates without pretending to be a navigable URL
 *   3. synthetic `zai-ref://{stage}/{index}` as last resort
 *
 * The title + snippet content still gets through, which is what the
 * synthesizer actually reads — source text beats source URLs for
 * quality of the final report. Clickable citations are a future spec.
 *
 * Dedupe by the resolved `url` (real link wins over opaque refer tag).
 */
function extractSearchReferences(
  payload: unknown,
  stage: LoopStage
): EngineSearchReference[] {
  if (!payload || typeof payload !== 'object') return [];
  const arr = (payload as { web_search?: unknown }).web_search;
  if (!Array.isArray(arr)) return [];

  const refs: EngineSearchReference[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < arr.length; i++) {
    const raw = arr[i];
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;

    const linkRaw = typeof o.link === 'string' ? o.link.trim() : '';
    const referRaw = typeof o.refer === 'string' ? o.refer.trim() : '';
    const titleRaw = typeof o.title === 'string' ? o.title.trim() : '';
    const contentRaw = typeof o.content === 'string' ? o.content : null;

    // Pick a stable identifier — real URL if available, else refer tag.
    let url: string;
    if (linkRaw.length > 0 && linkRaw.startsWith('http')) {
      url = linkRaw;
    } else if (referRaw.length > 0) {
      url = `zai-ref://${referRaw}`;
    } else {
      url = `zai-ref://${stage}/${i + 1}`;
    }

    // Skip completely empty entries (no title, no content, no refer).
    if (
      !linkRaw &&
      !referRaw &&
      !titleRaw &&
      (!contentRaw || contentRaw.trim().length === 0)
    ) {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);

    const publishDateRaw =
      typeof o.publish_date === 'string' ? o.publish_date.trim() : '';

    refs.push({
      url,
      title: titleRaw.length > 0 ? titleRaw : undefined,
      published_date: publishDateRaw.length > 0 ? publishDateRaw : undefined,
      stage,
      provider: 'zai',
      snippet: contentRaw ? truncate(contentRaw, 200) : undefined,
    });
  }
  return refs;
}

function extractSearchCount(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0;
  const arr = (payload as { web_search?: unknown }).web_search;
  return Array.isArray(arr) ? arr.length : 0;
}

function classifyHttpStatus(status: number): EngineErrorClass {
  // 401 = bad key, 402 = billing, 403 = forbidden/revoked → all surface as
  // CreditsExhausted for operator clarity (same convention as qwen-client).
  if (status === 401 || status === 402 || status === 403) return 'CreditsExhausted';
  if (status === 429) return 'RateLimited';
  if (status >= 500 && status < 600) return 'ServerError';
  // Other 4xx → ServerError (the httpStatus field carries the code).
  return 'ServerError';
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
