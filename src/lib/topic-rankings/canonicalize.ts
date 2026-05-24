/**
 * Weekly Canonicalize Engine — replaces the legacy ad-hoc OpenRouter call
 * inside `extract.ts`. Mirrors the shape of `daily-alert/canonicalize.ts`
 * but swaps the provider client for a direct `fetch` against OpenRouter
 * (the existing weekly-publish provider — see design "Provider choice").
 *
 * What's shared with the daily pipeline:
 *   - the prompt body (loaded from `prompt_templates.daily_canonicalization_prompt`)
 *   - the placeholder substituter (`daily-alert/substitute.ts`)
 *   - the response Zod schema (`CanonicalizeResponseSchema`)
 *   - the canonical-key normalizer (`normalizeCanonicalKey`)
 *
 * What's per-pipeline:
 *   - the wire-level provider (OpenRouter for weekly; Z.AI / GLM for daily)
 *   - the `failure_reason` string prefix (`"weekly canonicalize: ..."`)
 *
 * Failure model (Req 13):
 *   - HTTP 402 from provider                   → 'weekly canonicalize: provider credits exhausted'
 *   - HTTP 5xx / timeout / network             → retry up to 2× with backoff [500ms, 1000ms]
 *                                                 → on exhaustion: 'weekly canonicalize: provider unreachable'
 *   - JSON parse fail / Zod validation fail    → also retried (Req 13.3)
 *                                                 → on exhaustion: 'weekly canonicalize: malformed response'
 *   - Single per-keep key fails `normalizeCanonicalKey`
 *                                              → drop ONLY that topic with a `console.warn` log
 *                                                 carrying `'weekly canonicalize: malformed key'`,
 *                                                 continue processing remaining topics (Req 5.5).
 *
 * Spec refs:
 *   Requirements: 1.4, 5.5, 11.2, 11.3, 13.1, 13.2, 13.3, 13.4
 *   Design:       §`src/lib/topic-rankings/canonicalize.ts` — NEW
 *
 * Property refs (PBT, future task):
 *   P14, P17 — failure-mode naming + no-silent-failure
 *   P19, P20 — translate fan-out (downstream of this module)
 */

import {
  CanonicalizeResponseSchema,
  type CanonicalAssignment,
  type CanonicalizeResponse,
  type ScanTopic,
  normalizeCanonicalKey,
} from './zod-schemas';
import type { TopicCanonicalRow } from '@/types/daily-alert';
import { substitute } from '@/lib/daily-alert/substitute';

// ══════════ Tunables ══════════

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Per-attempt fetch timeout. The publish path's overall budget is bounded
 * by Vercel Pro (60s/route on this project, but Inngest steps can run up
 * to 300s — and admin-triggered publish is not latency-sensitive per
 * Principle 1 `time doesn't matter`). We pick 90s for headroom.
 */
const REQUEST_TIMEOUT_MS = 90_000;

/** 1 initial attempt + 2 retries = 3 total attempts. */
const MAX_ATTEMPTS = 3;

/** Backoff between attempt[n] and attempt[n+1]: 500ms, then 1000ms. */
const BACKOFF_MS = [500, 1000] as const;

const RAW_OUTPUT_TRUNCATE = 500;

// ══════════ Public types ══════════

export interface WeeklyCanonicalizeInput {
  canonPrompt: string;
  /**
   * Topics built by `buildScannedTopicsFromModule(...)` from one module's
   * `report.content.modules[i].topTopics`. Only the canonicalize-relevant
   * fields (`topic_name_zh`, `summary_zh`, `keywords`) are populated.
   */
  scannedTopics: ScanTopic[];
  /** Full list of existing canonicals for this domain, no `origin` filter. */
  existingCanonicals: TopicCanonicalRow[];
  domainName: string;
  openRouterApiKey: string;
  /** For log breadcrumbs: every line includes `[publish ${reportId}]`. */
  reportId: string;
}

export type WeeklyCanonicalizeResult =
  | {
      ok: true;
      /**
       * Assignments whose decision is `'keep'`. Keys are already normalized
       * via `normalizeCanonicalKey`; only these proceed to `persist.ts`.
       */
      keptAssignments: CanonicalAssignment[];
      /**
       * Assignments whose decision is `'drop'`. Surfaced separately so
       * callers can log per-topic drop reasons (Req 11.4) without
       * re-walking the full assignment array.
       */
      droppedAssignments: CanonicalAssignment[];
      /**
       * The cleaned assistant content (after `stripCodeFences`) — handy
       * for the success log line and for tests that verify byte-stability.
       */
      rawContent: string;
    }
  | {
      ok: false;
      failureReason: string;
      /** Truncated raw provider output (≤ 500 chars). */
      rawOutput: string;
    };

// ══════════ Public function ══════════

export async function runWeeklyCanonicalize(
  input: WeeklyCanonicalizeInput
): Promise<WeeklyCanonicalizeResult> {
  const {
    canonPrompt,
    scannedTopics,
    existingCanonicals,
    domainName,
    openRouterApiKey,
    reportId,
  } = input;

  // 1. Fail fast on missing API key (Req 13.4) — never even attempt the LLM call.
  if (!openRouterApiKey) {
    return {
      ok: false,
      failureReason:
        'weekly canonicalize: provider API key missing OPENROUTER_API_KEY',
      rawOutput: '',
    };
  }

  // 2. Build the two narrow JSON projections the prompt's placeholders consume.
  //    Mirror daily-alert/canonicalize.ts so prompt drift between pipelines
  //    is structurally impossible.
  const scannedTopicsJson = JSON.stringify(
    scannedTopics.map((topic, index) => ({
      scanned_topic_index: index,
      topic_name_zh: topic.topic_name_zh,
      summary_zh: topic.summary_zh,
      keywords: topic.keywords,
    }))
  );

  const existingCanonicalsJson = JSON.stringify(
    existingCanonicals.map((row) => ({
      canonical_topic_key: row.canonical_topic_key,
      canonical_title_zh: row.canonical_title_zh,
      canonical_description_zh: row.canonical_description_zh,
      category_slug: row.category_slug,
      secondary_axis_type: row.secondary_axis_type,
      secondary_axis_value: row.secondary_axis_value,
    }))
  );

  const resolvedPrompt = substitute(canonPrompt, {
    scanned_topics_json: scannedTopicsJson,
    existing_canonicals_json: existingCanonicalsJson,
    domain_name: domainName,
  });

  // 3. Retry loop. HTTP 402 terminates immediately with `provider credits
  //    exhausted`. HTTP 5xx / network / timeout / malformed / Zod-fail are
  //    all transient — retry up to MAX_ATTEMPTS, then surface the LATEST
  //    transient kind (so a final Zod failure surfaces as `malformed
  //    response`, while a final 5xx surfaces as `provider unreachable`).
  let lastTransient: TransientFailure | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = await attemptCanonicalize({
      apiKey: openRouterApiKey,
      resolvedPrompt,
    });

    if (result.kind === 'success') {
      return finalizeAssignments({
        parsed: result.parsed,
        rawContent: result.rawContent,
        reportId,
      });
    }

    if (result.kind === 'credits_exhausted') {
      // Persistent — never retry. Caller's route handler is responsible
      // for the structured `console.error` log line per Req 11.2; we just
      // surface the failure_reason string with the provider name.
      return {
        ok: false,
        failureReason: 'weekly canonicalize: provider credits exhausted',
        rawOutput: result.rawOutput,
      };
    }

    lastTransient = result;

    if (attempt < MAX_ATTEMPTS - 1) {
      await sleep(BACKOFF_MS[attempt] ?? 1000);
    }
  }

  // Retries exhausted. Surface the latest transient kind.
  if (lastTransient?.kind === 'malformed') {
    return {
      ok: false,
      failureReason: 'weekly canonicalize: malformed response',
      rawOutput: lastTransient.rawOutput,
    };
  }

  return {
    ok: false,
    failureReason: 'weekly canonicalize: provider unreachable',
    rawOutput: lastTransient?.rawOutput ?? '',
  };
}

// ══════════ Internal: per-attempt result ══════════

type TransientFailure =
  | { kind: 'unreachable'; rawOutput: string }
  | { kind: 'malformed'; rawOutput: string };

type AttemptResult =
  | { kind: 'success'; parsed: CanonicalizeResponse; rawContent: string }
  | { kind: 'credits_exhausted'; rawOutput: string }
  | TransientFailure;

async function attemptCanonicalize(args: {
  apiKey: string;
  resolvedPrompt: string;
}): Promise<AttemptResult> {
  const { apiKey, resolvedPrompt } = args;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // OpenRouter recommends these headers for server-side calls; some
        // upstream provider routes return 4xx without them.
        'HTTP-Referer': 'https://radar-report-platform.vercel.app',
        'X-Title': 'Radar Report Platform',
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        messages: [{ role: 'user', content: resolvedPrompt }],
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      kind: 'unreachable',
      rawOutput: truncate(`network/timeout: ${msg}`, RAW_OUTPUT_TRUNCATE),
    };
  }
  clearTimeout(timer);

  // HTTP 402 → credits exhausted (Req 13.1). Persistent — caller does not retry.
  if (response.status === 402) {
    const body = await safeReadText(response);
    return {
      kind: 'credits_exhausted',
      rawOutput: truncate(body, RAW_OUTPUT_TRUNCATE),
    };
  }

  // Any other non-2xx → treat as transient (Req 13.2).
  if (!response.ok) {
    const body = await safeReadText(response);
    return {
      kind: 'unreachable',
      rawOutput: truncate(
        `HTTP ${response.status} ${response.statusText}: ${body}`,
        RAW_OUTPUT_TRUNCATE
      ),
    };
  }

  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      kind: 'malformed',
      rawOutput: truncate(
        `envelope JSON parse failed: ${msg}`,
        RAW_OUTPUT_TRUNCATE
      ),
    };
  }

  const rawAssistantContent = extractAssistantContent(envelope);
  if (rawAssistantContent === null) {
    return {
      kind: 'malformed',
      rawOutput: truncate(
        'OpenRouter response had no choices[0].message.content',
        RAW_OUTPUT_TRUNCATE
      ),
    };
  }

  const cleaned = stripCodeFences(rawAssistantContent);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      kind: 'malformed',
      rawOutput: truncate(
        `assistant content not valid JSON: ${msg} | raw: ${cleaned}`,
        RAW_OUTPUT_TRUNCATE
      ),
    };
  }

  const parsed = CanonicalizeResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      kind: 'malformed',
      rawOutput: truncate(
        `Zod validation failed: ${parsed.error.message} | raw: ${cleaned}`,
        RAW_OUTPUT_TRUNCATE
      ),
    };
  }

  return { kind: 'success', parsed: parsed.data, rawContent: cleaned };
}

// ══════════ Internal: post-success normalization ══════════

function finalizeAssignments(args: {
  parsed: CanonicalizeResponse;
  rawContent: string;
  reportId: string;
}): WeeklyCanonicalizeResult {
  const { parsed, rawContent, reportId } = args;

  const keptAssignments: CanonicalAssignment[] = [];
  const droppedAssignments: CanonicalAssignment[] = [];

  for (const assignment of parsed.assignments) {
    if (assignment.decision === 'drop') {
      // Drop branch — Zod already enforced all-nulls and a non-empty
      // drop_reason. Pass through unchanged.
      droppedAssignments.push(assignment);
      continue;
    }

    // Keep branch — normalize the key. A single bad key converts to a
    // synthetic drop (was: silently skipped) so the per-module assignment
    // array stays length-N — the persist RPC validates
    // `length(assignments) == length(scanned_topics)` per module and
    // rejects the run otherwise. Partial success preferred over all-or-
    // nothing failure (Req 5.5).
    try {
      const normalizedKey = normalizeCanonicalKey(assignment.canonical_topic_key);
      keptAssignments.push({
        ...assignment,
        canonical_topic_key: normalizedKey,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[publish ${reportId}] failure_reason="weekly canonicalize: malformed key" ` +
          `scanned_topic_index=${assignment.scanned_topic_index} ` +
          `key="${assignment.canonical_topic_key}" detail="${msg}"`
      );
      // Push a synthetic drop so total = N. Shape matches
      // CanonicalAssignmentDropSchema: all keep-only fields nulled,
      // `is_new_canonical` is the literal `false`, `drop_reason` is
      // a non-empty string carrying the upstream error message.
      droppedAssignments.push({
        scanned_topic_index: assignment.scanned_topic_index,
        decision: 'drop',
        bucket: null,
        drop_reason: truncate(
          `malformed canonical key from engine: ${msg}`,
          300
        ),
        canonical_topic_key: null,
        is_new_canonical: false,
        category_slug: null,
        secondary_axis_type: null,
        secondary_axis_value: null,
      } as CanonicalAssignment);
    }
  }

  return {
    ok: true,
    keptAssignments,
    droppedAssignments,
    rawContent,
  };
}

// ══════════ Helpers ══════════

function extractAssistantContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const choices = (payload as { choices?: unknown[] }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  return typeof content === 'string' ? content : null;
}

/**
 * Strips ```json ... ``` or ``` ... ``` code fences if present. OpenRouter
 * occasionally wraps JSON in fences even when `response_format: json_object`
 * was requested (model-dependent — e.g. some Claude routes do this).
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json|JSON)?\r?\n?/, '')
    .replace(/\r?\n?```$/, '')
    .trim();
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ══════════ Public: dictionary true-up ══════════

/**
 * Reconcile `is_new_canonical` against an authoritative dictionary
 * snapshot, AND defend against the LLM hallucinating reuse against a
 * key that doesn't exist.
 *
 * Four quadrants:
 *   1. keep + is_new_canonical=true  + key NOT in dict  → unchanged (will INSERT)
 *   2. keep + is_new_canonical=true  + key IS  in dict  → flip flag to false
 *      (engine didn't know — RPC's UPSERT branch will skip the INSERT and
 *      just bump seen_count). Safe because the title is already in the
 *      dictionary; we don't need the engine's title fields.
 *   3. keep + is_new_canonical=false + key IS  in dict  → unchanged (reuse)
 *   4. keep + is_new_canonical=false + key NOT in dict  → HALLUCINATED
 *      REUSE. The engine claimed reuse but didn't populate
 *      `canonical_title_zh` / `canonical_description_zh` / `category_slug`
 *      because it thought it was reusing. Flipping to true and trying to
 *      INSERT would crash the RPC on the NOT NULL constraint of
 *      `canonical_title_zh`. Replace with a synthetic drop instead, with
 *      a `drop_reason` that surfaces the hallucination for the operator.
 *
 * Drop assignments pass through unchanged — they don't touch the
 * dictionary regardless of the engine's flag.
 */
export function applyDictionaryTrueUp(args: {
  assignments: CanonicalAssignment[];
  existingCanonicalKeys: Set<string>;
  reportId: string;
}): CanonicalAssignment[] {
  const { assignments, existingCanonicalKeys, reportId } = args;

  return assignments.map((a) => {
    if (a.decision !== 'keep') return a;

    const keyExists = existingCanonicalKeys.has(a.canonical_topic_key);

    if (a.is_new_canonical === true && keyExists) {
      // Quadrant 2: dictionary already has this key. Flip to false; the
      // RPC will skip the canonicals INSERT and just bump seen_count.
      return { ...a, is_new_canonical: false } as CanonicalAssignment;
    }

    if (a.is_new_canonical === false && !keyExists) {
      // Quadrant 4: hallucinated reuse. Replace with a synthetic drop.
      const truncatedKey = truncate(a.canonical_topic_key, 50);
      console.warn(
        `[publish ${reportId}] hallucinated reuse ` +
          `scanned_topic_index=${a.scanned_topic_index} ` +
          `canonical_topic_key="${a.canonical_topic_key}"`
      );
      return {
        scanned_topic_index: a.scanned_topic_index,
        decision: 'drop',
        bucket: null,
        drop_reason: truncate(
          `hallucinated reuse: engine claimed canonical key "${truncatedKey}" exists but it is not in the dictionary`,
          300
        ),
        canonical_topic_key: null,
        is_new_canonical: false,
        category_slug: null,
        secondary_axis_type: null,
        secondary_axis_value: null,
      } as CanonicalAssignment;
    }

    // Quadrants 1 + 3: flag already agrees with the dictionary. No change.
    return a;
  });
}

/**
 * Build the per-module assignment array passed to
 * `persist_weekly_topic_rankings`.
 *
 * The RPC validates that `length(assignments) == length(scanned_topics)`
 * for every module; passing only the kept slice is what caused the
 * `module 0 length mismatch (topics=N assignments=K)` failure mode in
 * the backfill. Sort by `scanned_topic_index` ascending so kept and
 * dropped rows interleave in the same order as the original
 * `scannedTopicsByModule[k]` array.
 */
export function buildPerModuleAssignments(args: {
  keptAssignments: CanonicalAssignment[];
  droppedAssignments: CanonicalAssignment[];
}): CanonicalAssignment[] {
  return [...args.keptAssignments, ...args.droppedAssignments].sort(
    (a, b) => a.scanned_topic_index - b.scanned_topic_index
  );
}
