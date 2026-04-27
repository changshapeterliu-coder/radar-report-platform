import { SHARED_CHANNEL_PROFILE } from '../system-prompts';
import type { CoverageWindow } from '../types';
import {
  runEngineLoop,
  type EngineLoopResult,
  type StageRunner,
} from './loop';

/**
 * Engine A — DeepSeek V3.2.
 *
 * File name / function name kept as "gemini" to preserve DB column mapping
 * (scheduled_runs.gemini_output) and avoid ripple-refactoring generate-report.ts.
 * The model running inside is whatever DEFAULT_MODEL points to.
 */
const DEFAULT_MODEL = 'deepseek/deepseek-v3.2';
const DEFAULT_RESEARCHER_MODEL = 'deepseek/deepseek-v3.2:online';

export interface GeminiLoopInput {
  coverageWindow: CoverageWindow;
  domainName: string;
  geminiPrompt: string;
  openRouterApiKey: string;
  maxSubquestionsPerRound: number;
  /** How many top topics per module to deep-dive (typically 3). */
  deepDivePerModule: number;
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
      deepDivePerModule: input.deepDivePerModule,
      plannerTimeoutMs: 2 * 60_000,
      broadResearcherTimeoutMs: 4 * 60_000,
      top5RankerTimeoutMs: 2 * 60_000,
      deepResearcherTimeoutMs: 4 * 60_000,
      engineSummarizerTimeoutMs: 3 * 60_000,
    },
    stageRunner
  );
}
