import { KIMI_CHANNEL_PROFILE } from '../system-prompts';
import type { CoverageWindow } from '../types';
import {
  runEngineLoop,
  type EngineLoopResult,
  type StageRunner,
} from './loop';

const DEFAULT_MODEL = 'moonshotai/kimi-k2-0905';
/**
 * `:online` suffix routes through OpenRouter's Exa web-search wrapper so the
 * researcher stages get real-time results instead of training-data answers.
 * See https://openrouter.ai/docs/features/web-search — $0.004/request + model price.
 */
const DEFAULT_RESEARCHER_MODEL = 'moonshotai/kimi-k2-0905:online';

export interface KimiLoopInput {
  coverageWindow: CoverageWindow;
  domainName: string;
  kimiPrompt: string;
  openRouterApiKey: string;
  maxSubquestionsPerRound: number;
  maxGapSubquestions: number;
}

export async function runKimiLoop(
  input: KimiLoopInput,
  stageRunner: StageRunner
): Promise<EngineLoopResult> {
  return runEngineLoop(
    {
      engineLabel: 'kimi',
      model: DEFAULT_MODEL,
      researcherModel: DEFAULT_RESEARCHER_MODEL,
      channelProfile: KIMI_CHANNEL_PROFILE,
      researcherPrompt: input.kimiPrompt,
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
