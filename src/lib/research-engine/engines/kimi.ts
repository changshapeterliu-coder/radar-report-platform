import type { CoverageWindow } from '../types';
import {
  runEngineLoop,
  type EngineLoopResult,
  type StageRunner,
} from './loop';

/**
 * Engine B — Moonshot Kimi K2.
 *
 * File name kept as "kimi" to preserve DB column mapping (scheduled_runs.kimi_output).
 */
const DEFAULT_MODEL = 'moonshotai/kimi-k2-0905';
const DEFAULT_RESEARCHER_MODEL = 'moonshotai/kimi-k2-0905:online';

export interface KimiLoopInput {
  coverageWindow: CoverageWindow;
  domainName: string;
  /** DB-editable Stage 1 prompt (engine_b_hot_radar). */
  engineBHotRadarPrompt: string;
  /** DB-editable Stage 2 prompt (shared_deep_dive). */
  sharedDeepDivePrompt: string;
  openRouterApiKey: string;
  /** How many top topics per module to deep-dive. Default 3. */
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
      hotRadarPrompt: input.engineBHotRadarPrompt,
      deepDivePrompt: input.sharedDeepDivePrompt,
      coverageWindow: input.coverageWindow,
      domainName: input.domainName,
      openRouterApiKey: input.openRouterApiKey,
      deepDivePerModule: input.deepDivePerModule,
      hotRadarTimeoutMs: 4 * 60_000,
      deepDiveTimeoutMs: 5 * 60_000,
      educationMapperTimeoutMs: 2 * 60_000,
      assemblerTimeoutMs: 3 * 60_000,
    },
    stageRunner
  );
}
