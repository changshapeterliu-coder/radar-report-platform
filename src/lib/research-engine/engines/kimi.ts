import { SHARED_CHANNEL_PROFILE } from '../system-prompts';
import type { CoverageWindow } from '../types';
import {
  runEngineLoop,
  type EngineLoopResult,
  type StageRunner,
} from './loop';

/**
 * Engine B — Moonshot Kimi K2.
 *
 * File name kept as "kimi" to preserve DB column mapping
 * (scheduled_runs.kimi_output).
 */
const DEFAULT_MODEL = 'moonshotai/kimi-k2-0905';
const DEFAULT_RESEARCHER_MODEL = 'moonshotai/kimi-k2-0905:online';

export interface KimiLoopInput {
  coverageWindow: CoverageWindow;
  domainName: string;
  kimiPrompt: string;
  openRouterApiKey: string;
  maxSubquestionsPerRound: number;
  /** How many top topics per module to deep-dive (typically 3). */
  deepDivePerModule: number;
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
      channelProfile: SHARED_CHANNEL_PROFILE,
      researcherPrompt: input.kimiPrompt,
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
