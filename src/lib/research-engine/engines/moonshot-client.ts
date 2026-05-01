import type {
  EngineError,
  EngineErrorClass,
  EngineSearchReference,
  LoopStage,
} from '../types';
import { stripCodeFences, type ChatMessage } from './openrouter-client';

const MOONSHOT_ENDPOINT = 'https://api.moonshot.cn/v1/chat/completions';

/**
 * Maximum tool_calls loop iterations.
 *
 * Moonshot's $web_search drives a multi-round agent: assistant asks for a
 * search → we echo args back as tool message → Kimi executes search → assistant
 * generates another tool_call or stops. Capping at 4 iterations ensures:
 *   (a) we don't run away in a pathological case
 *   (b) the whole loop fits within our per-stage timeout budget (50s / 2s per
 *       iteration of HTTP + Kimi work = comfortable)
 */
const MAX_TOOL_CALL_ITERATIONS = 4;

/**
 * Moonshot-shaped tool_call from assistant message. Only the fields we use.
 */
interface MoonshotToolCall {
  id: string;
  type: 'function' | 'builtin_function';
  function: {
    name: string;
    /** JSON-encoded arguments. For $web_search this includes query + usage + search results. */
    arguments: string;
  };
}

interface MoonshotAssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: MoonshotToolCall[];
}

export interface MoonshotCallParams {
  /** e.g. 'kimi-k2.6' (dynamic context, recommended for $web_search). */
  model: string;
  messages: ChatMessage[];
  apiKey: string;
  /** Hard cap on the entire tool-calling loop. */
  timeoutMs: number;
  /** If true, request `response_format: { type: 'json_object' }` on the final turn. */
  jsonMode?: boolean;
  /** Which loop stage + engine label we're running — used in error context. */
  errorContext: {
    engine: 'gemini' | 'kimi' | 'synthesizer';
    stage?: LoopStage;
    topicIndex?: number;
  };
}

export type MoonshotResult<T> =
  | {
      ok: true;
      data: T;
      rawContent: string;
      searchReferences: EngineSearchReference[];
      /** Number of $web_search invocations Kimi made. */
      searchCount: number;
    }
  | { ok: false; error: EngineError };

/**
 * Calls Moonshot with $web_search builtin tool enabled, running the tool_calls
 * loop until the assistant returns a final content message or we hit the cap.
 *
 * Moonshot's $web_search contract (per platform.moonshot.cn docs):
 *   - Declare tool as { type: 'builtin_function', function: { name: '$web_search' } }
 *   - When finish_reason === 'tool_calls', Kimi returns one or more tool_calls
 *     where function.arguments is a JSON string containing the search plan AND
 *     (after the user submits it back as a tool message) the search results.
 *   - The caller must echo tool_call.function.arguments unchanged as the tool
 *     response — Kimi itself performs the search.
 *   - Thinking mode must be disabled via extra_body.
 *
 * Reference extraction: after each tool_call round, parse
 * tool_call.function.arguments for any { url, title, date } entries and
 * collect them as EngineSearchReference.
 */
export async function callMoonshot<T = unknown>(
  params: MoonshotCallParams
): Promise<MoonshotResult<T>> {
  const { model, messages, apiKey, timeoutMs, jsonMode, errorContext } = params;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  // Conversation accumulates across tool_calls iterations.
  // Use OpenAI-compatible shape (role + content [+ tool_calls / tool_call_id]).
  const convo: Array<Record<string, unknown>> = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const searchReferences: EngineSearchReference[] = [];
  let searchCount = 0;

  try {
    for (let iter = 0; iter < MAX_TOOL_CALL_ITERATIONS; iter++) {
      const body: Record<string, unknown> = {
        model,
        messages: convo,
        tools: [
          {
            type: 'builtin_function',
            function: { name: '$web_search' },
          },
        ],
        // Moonshot docs require thinking disabled when using $web_search.
        thinking: { type: 'disabled' },
      };
      // Only request JSON mode on iterations where no tool_calls are pending,
      // i.e. the final-answer turn. Keeping it on throughout is safe because
      // the OpenAI JSON mode is ignored when the model emits tool_calls.
      if (jsonMode) {
        body.response_format = { type: 'json_object' };
      }

      let response: Response;
      try {
        response = await fetch(MOONSHOT_ENDPOINT, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } catch (err: unknown) {
        const errorClass: EngineErrorClass =
          err instanceof Error && err.name === 'AbortError'
            ? 'TimeoutError'
            : 'NetworkError';
        return {
          ok: false,
          error: {
            ...errorContext,
            errorClass,
            message:
              err instanceof Error
                ? `Moonshot ${errorClass}: ${err.message}`
                : 'Unknown network error calling Moonshot',
          },
        };
      }

      if (!response.ok) {
        const errorClass = classifyHttpStatus(response.status);
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
                ? `Moonshot credits exhausted (${errorContext.engine})`
                : `Moonshot ${response.status} ${response.statusText}${bodyText ? `: ${truncate(bodyText, 200)}` : ''}`,
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
            message: `Moonshot envelope is not JSON: ${err instanceof Error ? err.message : String(err)}`,
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
            message: 'Moonshot response had no choices[0]',
          },
        };
      }
      const { finishReason, message } = choice;

      // If finish_reason is 'tool_calls', echo each tool_call args back as
      // a tool-role message. Kimi will then use them to actually search.
      if (finishReason === 'tool_calls') {
        if (!message.tool_calls || message.tool_calls.length === 0) {
          return {
            ok: false,
            error: {
              ...errorContext,
              errorClass: 'MalformedResponse',
              message:
                'Moonshot returned finish_reason=tool_calls but no tool_calls array',
            },
          };
        }

        // Push the assistant turn (must include tool_calls field so Kimi
        // can match its own call ids on the next turn).
        convo.push({
          role: 'assistant',
          content: message.content ?? '',
          tool_calls: message.tool_calls,
        });

        for (const tc of message.tool_calls) {
          if (tc.function.name === '$web_search') {
            searchCount += 1;
            const parsedArgs = safeJsonParse(tc.function.arguments);
            collectSearchReferences(
              parsedArgs,
              errorContext.stage ?? 'hot-radar-scan',
              searchReferences
            );
          }
          // Echo args back verbatim — this is what Moonshot docs require.
          convo.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: tc.function.arguments,
          });
        }

        // Continue loop for next assistant turn.
        continue;
      }

      // finish_reason === 'stop' (or anything non-tool_calls) — terminal turn.
      const rawContent = typeof message.content === 'string' ? message.content : '';
      if (!rawContent) {
        return {
          ok: false,
          error: {
            ...errorContext,
            errorClass: 'MalformedResponse',
            message: 'Moonshot final turn had empty content',
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
            message: `Moonshot final content is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
      }

      return {
        ok: true,
        data: parsed,
        rawContent: cleaned,
        searchReferences: dedupeReferences(searchReferences),
        searchCount,
      };
    }

    // Exceeded iteration cap without finish_reason=stop.
    return {
      ok: false,
      error: {
        ...errorContext,
        errorClass: 'MalformedResponse',
        message: `Moonshot exceeded ${MAX_TOOL_CALL_ITERATIONS} tool_calls rounds without terminating`,
      },
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// ==========================================================
// Response parsing helpers
// ==========================================================

interface ChoiceSlice {
  finishReason: string;
  message: MoonshotAssistantMessage;
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
  const messageRaw = first.message;
  if (!messageRaw || typeof messageRaw !== 'object') return null;
  const m = messageRaw as Record<string, unknown>;
  return {
    finishReason,
    message: {
      role: 'assistant',
      content: typeof m.content === 'string' ? m.content : null,
      tool_calls: Array.isArray(m.tool_calls)
        ? m.tool_calls.filter(isToolCall)
        : undefined,
    },
  };
}

function isToolCall(raw: unknown): raw is MoonshotToolCall {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  const fn = o.function as Record<string, unknown> | undefined;
  return (
    typeof o.id === 'string' &&
    typeof o.type === 'string' &&
    fn !== undefined &&
    typeof fn.name === 'string' &&
    typeof fn.arguments === 'string'
  );
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function classifyHttpStatus(status: number): EngineErrorClass {
  if (status === 401 || status === 403) return 'CreditsExhausted';
  if (status === 402) return 'CreditsExhausted';
  if (status === 429) return 'RateLimited';
  if (status >= 500 && status < 600) return 'ServerError';
  return 'ServerError';
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}

// ==========================================================
// Search reference extraction (best-effort)
// ==========================================================

/**
 * Walks the parsed $web_search arguments object and collects any entries
 * that look like search results (i.e. carry a URL). Moonshot's $web_search
 * returns a shape roughly like:
 *   {
 *     search_result: [
 *       { url, title, date?, snippet? },
 *       ...
 *     ],
 *     usage: { total_tokens: N }
 *   }
 * but the exact field names can vary. We match any nested object with a
 * string `url` field and opportunistically pick up title / date / snippet.
 */
function collectSearchReferences(
  raw: unknown,
  stage: LoopStage,
  into: EngineSearchReference[]
): void {
  if (!raw) return;
  walk(raw, (node) => {
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (typeof o.url === 'string' && o.url.startsWith('http')) {
      into.push({
        url: o.url,
        title: typeof o.title === 'string' ? o.title : undefined,
        published_date: firstDateField(o),
        stage,
        provider: 'moonshot',
        snippet:
          typeof o.snippet === 'string'
            ? truncate(o.snippet, 200)
            : typeof o.content === 'string'
              ? truncate(o.content, 200)
              : undefined,
      });
    }
  });
}

function walk(node: unknown, visit: (n: unknown) => void): void {
  visit(node);
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const v of node) walk(v, visit);
    return;
  }
  for (const v of Object.values(node as Record<string, unknown>)) {
    walk(v, visit);
  }
}

function firstDateField(o: Record<string, unknown>): string | undefined {
  for (const key of ['date', 'published_date', 'publish_date', 'pubDate']) {
    const v = o[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function dedupeReferences(refs: EngineSearchReference[]): EngineSearchReference[] {
  const seen = new Set<string>();
  const out: EngineSearchReference[] = [];
  for (const r of refs) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out;
}
