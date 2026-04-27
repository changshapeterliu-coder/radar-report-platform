import type { EngineError, EngineErrorClass, LoopStage } from '../types';

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface OpenRouterCallParams {
  model: string;
  messages: ChatMessage[];
  apiKey: string;
  timeoutMs: number;
  /** If true, request `response_format: { type: 'json_object' }`. Not all models support this; we also strip code fences from the reply to be safe. */
  jsonMode?: boolean;
  /** Extra context for failure_reason formatting. */
  errorContext: {
    engine: 'gemini' | 'kimi' | 'synthesizer';
    stage?: LoopStage;
    subquestionIndex?: number;
  };
}

export type OpenRouterResult<T> =
  | { ok: true; data: T; rawContent: string }
  | { ok: false; error: EngineError };

/**
 * Strips ```json ... ``` or ``` ... ``` code fences if present.
 * Some LLMs wrap JSON in fences even when asked not to.
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json|JSON)?\r?\n?/, '')
    .replace(/\r?\n?```$/, '')
    .trim();
}

/**
 * Calls OpenRouter with a timeout, parses JSON from the assistant reply,
 * and classifies errors into our EngineError taxonomy. The returned
 * `data` is whatever JSON the model produced — the caller should
 * validate the shape.
 */
export async function callOpenRouter<T = unknown>(
  params: OpenRouterCallParams
): Promise<OpenRouterResult<T>> {
  const { model, messages, apiKey, timeoutMs, jsonMode, errorContext } = params;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // OpenRouter recommends these for server-side calls; some provider
        // routes (notably Gemini) return 4xx without them.
        'HTTP-Referer': 'https://radar-report-platform.vercel.app',
        'X-Title': 'Radar Report Platform',
      },
      body: JSON.stringify({
        model,
        messages,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
  } catch (err: unknown) {
    clearTimeout(timeoutHandle);
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
            ? err.message
            : 'Unknown network error calling OpenRouter',
      },
    };
  }

  clearTimeout(timeoutHandle);

  if (!response.ok) {
    const errorClass = classifyHttpStatus(response.status);
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch {
      // ignore — we already have the status code
    }
    return {
      ok: false,
      error: {
        ...errorContext,
        errorClass,
        httpStatus: response.status,
        message:
          errorClass === 'CreditsExhausted'
            ? `OpenRouter credits exhausted (${errorContext.engine})`
            : `${response.status} ${response.statusText}${bodyText ? `: ${truncate(bodyText, 200)}` : ''}`,
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
        message: `Failed to parse OpenRouter envelope as JSON: ${err instanceof Error ? err.message : String(err)}`,
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
        message: 'OpenRouter response had no choices[0].message.content',
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
        message: `Assistant content is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  return { ok: true, data: parsed, rawContent: cleaned };
}

function classifyHttpStatus(status: number): EngineErrorClass {
  if (status === 402) return 'CreditsExhausted';
  if (status === 429) return 'RateLimited';
  if (status >= 500 && status < 600) return 'ServerError';
  // 4xx other than 402/429 — treat as server/malformed request.
  // We lump into ServerError for simplicity; the httpStatus field
  // captures the specific code.
  return 'ServerError';
}

function extractAssistantContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const choices = (payload as { choices?: unknown[] }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  return typeof content === 'string' ? content : null;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}
