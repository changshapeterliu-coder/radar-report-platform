import { GEMINI_CHANNEL_PROFILE } from '../system-prompts';
import type { CoverageWindow } from '../types';
import {
  runEngineLoop,
  type EngineLoopResult,
  type StageRunner,
} from './loop';

const DEFAULT_MODEL = 'google/gemini-2.5-pro';
/**
 * `:online` suffix routes through OpenRouter's Exa web-search wrapper so the
 * researcher stages get real-time results instead of training-data answers.
 * See https://openrouter.ai/docs/features/web-search — $0.004/request + model price.
 */
const DEFAULT_RESEARCHER_MODEL = 'google/gemini-2.5-pro:online';

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
      channelProfile: GEMINI_CHANNEL_PROFILE,
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
