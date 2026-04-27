import type {
  EngineError,
  ResearchEngineInput,
  ResearchEngineOutput,
} from './types';
import { runGeminiLoop } from './engines/gemini';
import { runKimiLoop } from './engines/kimi';
import { DEFAULT_STAGE_RUNNER, type StageRunner } from './engines/loop';
import { synthesize } from './synthesizer';

const DEFAULT_ENGINE_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_SYNTH_TIMEOUT_MS = 3 * 60_000;
const DEFAULT_MAX_SUBQUESTIONS = 12;
const DEFAULT_DEEP_DIVE_PER_MODULE = 3;

export type { StageRunner } from './engines/loop';
export type {
  CoverageWindow,
  EngineError,
  EngineErrorClass,
  EngineLoopTrace,
  LoopStage,
  ResearchEngineInput,
  ResearchEngineOutput,
} from './types';

export interface RunOptions {
  /**
   * Caller-injected stage runner. Inngest injects step.run for independent
   * retries/observability per stage. Default = direct call (for testing).
   *
   * Signature carefully shaped so the research-engine module itself never
   * imports `inngest`. That import stays in the caller.
   */
  stageRunner?: StageRunner;
}

/**
 * Top-level research engine entry point.
 *
 * Runs both engine loops in parallel, then synthesizes their outputs into
 * a final ReportContent. Partial failures are tolerated:
 *   - One engine loop fails → synthesizer gets "null (engine failed)" for that side
 *   - Both engines fail → synthesizer is NOT invoked; content returns as null
 *   - Synthesizer itself fails → content returns as null, synth error recorded
 *
 * Pure async function. No DB writes, no Inngest events, no notifications.
 */
export async function run(
  input: ResearchEngineInput,
  options: RunOptions = {}
): Promise<ResearchEngineOutput> {
  const stageRunner = options.stageRunner ?? DEFAULT_STAGE_RUNNER;
  const maxSubquestionsPerRound =
    input.maxSubquestionsPerRound ?? DEFAULT_MAX_SUBQUESTIONS;
  const deepDivePerModule =
    input.deepDivePerModule ?? DEFAULT_DEEP_DIVE_PER_MODULE;
  const synthTimeoutMs = input.synthTimeoutMs ?? DEFAULT_SYNTH_TIMEOUT_MS;
  // engineTimeoutMs is advisory; stage-level timeouts in loop.ts are the source of truth.
  void (input.engineTimeoutMs ?? DEFAULT_ENGINE_TIMEOUT_MS);

  // Run both engine loops in parallel. Each loop is internally resilient
  // (partial failures collected in its errors array); catastrophic errors
  // surface as allSettled rejections that we convert to EngineError.
  const [geminiSettled, kimiSettled] = await Promise.allSettled([
    runGeminiLoop(
      {
        coverageWindow: input.coverageWindow,
        domainName: input.domainName,
        geminiPrompt: input.geminiPrompt,
        openRouterApiKey: input.openRouterApiKey,
        maxSubquestionsPerRound,
        deepDivePerModule,
      },
      stageRunner
    ),
    runKimiLoop(
      {
        coverageWindow: input.coverageWindow,
        domainName: input.domainName,
        kimiPrompt: input.kimiPrompt,
        openRouterApiKey: input.openRouterApiKey,
        maxSubquestionsPerRound,
        deepDivePerModule,
      },
      stageRunner
    ),
  ]);

  const errors: EngineError[] = [];

  const gemini =
    geminiSettled.status === 'fulfilled'
      ? geminiSettled.value
      : (() => {
          errors.push({
            engine: 'gemini',
            errorClass: 'NetworkError',
            message: `Gemini loop rejected: ${String(geminiSettled.reason)}`,
          });
          return null;
        })();

  const kimi =
    kimiSettled.status === 'fulfilled'
      ? kimiSettled.value
      : (() => {
          errors.push({
            engine: 'kimi',
            errorClass: 'NetworkError',
            message: `Kimi loop rejected: ${String(kimiSettled.reason)}`,
          });
          return null;
        })();

  // Merge stage-level errors from successful loops.
  if (gemini) errors.push(...gemini.errors);
  if (kimi) errors.push(...kimi.errors);

  const geminiSummary = gemini?.summary ?? null;
  const kimiSummary = kimi?.summary ?? null;

  let content: ResearchEngineOutput['content'] = null;
  let synthesizerOutput: unknown = null;

  if (geminiSummary !== null || kimiSummary !== null) {
    const synthResult = await stageRunner('synthesize', () =>
      synthesize({
        geminiSummary,
        kimiSummary,
        synthesizerPrompt: input.synthesizerPrompt,
        coverageWindow: input.coverageWindow,
        openRouterApiKey: input.openRouterApiKey,
        timeoutMs: synthTimeoutMs,
      })
    );
    if (synthResult.ok) {
      content = synthResult.content;
      synthesizerOutput = synthResult.content;
    } else {
      errors.push(synthResult.error);
    }
  }

  return {
    content,
    engineOutputs: {
      gemini: gemini?.trace ?? null,
      kimi: kimi?.trace ?? null,
      synthesizer: synthesizerOutput,
    },
    errors,
  };
}
