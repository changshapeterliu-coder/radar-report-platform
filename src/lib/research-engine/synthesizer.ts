import type { ReportContent } from '@/types/report';
import { substitute } from './substitute';
import type { CoverageWindow, EngineError, EngineAssembledContent } from './types';
import { callOpenRouter, type ChatMessage } from './engines/openrouter-client';
import { formatDateRange } from '@/lib/inngest/coverage-window';

/**
 * Synthesizer model — DeepSeek V3.2 for stable, widely-provisioned
 * structured JSON output. V3.2 has 128k context which comfortably fits
 * both engines' assembled ReportContent.
 */
const DEFAULT_MODEL = 'deepseek/deepseek-v3.2';

export const REQUIRED_MODULE_TITLES = [
  'Account Suspension Trends',
  'Listing Takedown Trends',
  'Account Health Tool Feedback',
  'Education Opportunities',
] as const;

export interface SynthesizerInput {
  /** Engine A (gemini col in DB) assembled content, or null if loop failed. */
  geminiAssembled: EngineAssembledContent | null;
  /** Engine B (kimi col in DB) assembled content, or null if loop failed. */
  kimiAssembled: EngineAssembledContent | null;
  synthesizerPrompt: string;
  coverageWindow: CoverageWindow;
  openRouterApiKey: string;
  timeoutMs: number;
}

export type SynthesizerResult =
  | { ok: true; content: ReportContent; rawContent: string }
  | { ok: false; error: EngineError };

/**
 * Merges two engines' assembled ReportContent into one final ReportContent.
 *
 * Handles three cases:
 *   - Both engines succeeded: full cross-validation, cross_engine_confirmed tagging
 *   - One engine null: single-engine path, all topics labeled "单路观察"
 *   - Both null: caller should NOT invoke the synthesizer at all
 */
export async function synthesize(
  input: SynthesizerInput
): Promise<SynthesizerResult> {
  if (input.geminiAssembled === null && input.kimiAssembled === null) {
    return {
      ok: false,
      error: {
        engine: 'synthesizer',
        errorClass: 'MalformedResponse',
        message: 'Synthesizer invoked with both engines null',
      },
    };
  }

  // Human-readable YYYY-MM-DD ~ YYYY-MM-DD (Asia/Shanghai wall-clock).
  const startShanghai = formatDateRange(
    new Date(input.coverageWindow.startIso),
    new Date(input.coverageWindow.startIso)
  ).split(' ~ ')[0];
  const endShanghai = formatDateRange(
    new Date(input.coverageWindow.endIso),
    new Date(input.coverageWindow.endIso)
  ).split(' ~ ')[0];

  const resolvedPrompt = substitute(input.synthesizerPrompt, {
    start_date: startShanghai,
    end_date: endShanghai,
    week_label: input.coverageWindow.weekLabel,
    gemini_output:
      input.geminiAssembled !== null
        ? JSON.stringify(input.geminiAssembled)
        : 'null (engine failed)',
    kimi_output:
      input.kimiAssembled !== null
        ? JSON.stringify(input.kimiAssembled)
        : 'null (engine failed)',
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: resolvedPrompt },
    {
      role: 'user',
      content: 'Merge the two engine outputs per the rules in system prompt. Return the final ReportContent JSON.',
    },
  ];

  const raw = await callOpenRouter<unknown>({
    model: DEFAULT_MODEL,
    messages,
    apiKey: input.openRouterApiKey,
    timeoutMs: input.timeoutMs,
    jsonMode: true,
    errorContext: { engine: 'synthesizer' },
  });
  if (!raw.ok) return raw;

  const validation = validateSynthesizerOutput(raw.data);
  if (!validation.ok) {
    return {
      ok: false,
      error: {
        engine: 'synthesizer',
        errorClass: 'MalformedResponse',
        message: `Synthesizer output failed validation: ${validation.reason}`,
      },
    };
  }

  return { ok: true, content: validation.content, rawContent: raw.rawContent };
}

/**
 * Lightweight inline validation of the synthesizer's ReportContent output.
 * We intentionally do NOT import src/lib/validators/content-validator.ts
 * to keep the research-engine module dependency-isolated from business code
 * (Property 13: Research_Engine import isolation).
 *
 * Required invariants for scheduled draft creation:
 *   - title: non-empty string
 *   - dateRange: non-empty string
 *   - modules: exactly 4 entries with the canonical titles in canonical order
 *   - each module has a blocks array (may be empty)
 */
type ValidationResult =
  | { ok: true; content: ReportContent }
  | { ok: false; reason: string };

function validateSynthesizerOutput(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'output is not an object' };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.title !== 'string' || obj.title.trim() === '') {
    return { ok: false, reason: 'missing or empty title' };
  }
  if (typeof obj.dateRange !== 'string' || obj.dateRange.trim() === '') {
    return { ok: false, reason: 'missing or empty dateRange' };
  }
  if (!Array.isArray(obj.modules) || obj.modules.length !== 4) {
    return { ok: false, reason: `modules must be an array of exactly 4 entries (got ${Array.isArray(obj.modules) ? obj.modules.length : 'non-array'})` };
  }

  for (let i = 0; i < 4; i++) {
    const m = obj.modules[i] as Record<string, unknown>;
    if (!m || typeof m !== 'object') {
      return { ok: false, reason: `modules[${i}] is not an object` };
    }
    if (m.title !== REQUIRED_MODULE_TITLES[i]) {
      return {
        ok: false,
        reason: `modules[${i}].title must be "${REQUIRED_MODULE_TITLES[i]}" (got "${String(m.title)}")`,
      };
    }
    // blocks should exist as an array (may be empty)
    if (m.blocks !== undefined && !Array.isArray(m.blocks)) {
      return { ok: false, reason: `modules[${i}].blocks must be an array if present` };
    }
  }

  return { ok: true, content: obj as unknown as ReportContent };
}
