import { SHARED_CHANNEL_PROFILE } from '../system-prompts';
import type { CoverageWindow } from '../types';
import {
  runEngineLoop,
  type EngineLoopResult,
  type StageRunner,
} from './loop';

/**
 * Engine A — DeepSeek V4 Pro.
 *
 * File name / function name kept as "gemini" to preserve DB column mapping
 * (scheduled_runs.gemini_output) and avoid ripple-refactoring
 * generate-report.ts, RLS policies, and retention scripts. The model running
 * inside is whatever DEFAULT_MODEL points to — currently DeepSeek V4 Pro,
 * chosen because (1) 1M context fits the synthesizer trace comfortably,
 * (2) strong Chinese synthesis + structured JSON output, (3) not blocked by
 * the account's region restrictions on OpenAI/Anthropic/Google providers.
 */
const DEFAULT_MODEL = 'deepseek/deepseek-v4-pro';
/**
 * `:online` suffix routes through OpenRouter's Exa web-search wrapper so the
 * researcher stages get real-time results instead of training-data answers.
 * See https://openrouter.ai/docs/features/web-search — $0.004/request + model price.
 */
const DEFAULT_RESEARCHER_MODEL = 'deepseek/deepseek-v4-pro:online';

export interface GeminiLoopInput {
  coverageWindow: CoverageWindow;
  domainName: string;
  geminiPrompt: string;
  openRouterApiKey: string;
  maxSubquestionsPerRound: number;
  maxGapSubquestions: number;
}

export async function runGeminiLoop(
  input: GeminiLoopInput,
  stageRunner: StageRunner
): Promise<EngineLoopResult> {
  return runEngineLoop(
    {
      engineLabel: 'gemini',
      model: DEFAULT_MODEL,
      researcherModel: DEFAULT_RESEARCHER_MODEL,
      channelProfile: SHARED_CHANNEL_PROFILE,
      researcherPrompt: input.geminiPrompt,
      coverageWindow: input.coverageWindow,
      domainName: input.domainName,
      openRouterApiKey: input.openRouterApiKey,
      maxSubquestionsPerRound: input.maxSubquestionsPerRound,
      maxGapSubquestions: input.maxGapSubquestions,
      plannerTimeoutMs: 2 * 60_000,
      researcherTimeoutMs: 4 * 60_000,
      gapAnalyzerTimeoutMs: 2 * 60_000,
      engineSummarizerTimeoutMs: 3 * 60_000,
    },
    stageRunner
  );
}
