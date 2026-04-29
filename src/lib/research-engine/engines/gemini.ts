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
 * (scheduled_runs.gemini_output) and avoid ripple-refactoring the Inngest
 * function. The actual model running inside is DEFAULT_MODEL / DEFAULT_RESEARCHER_MODEL.
 */
const DEFAULT_MODEL = 'deepseek/deepseek-v3.2';
const DEFAULT_RESEARCHER_MODEL = 'deepseek/deepseek-v3.2:online';

export interface GeminiLoopInput {
  coverageWindow: CoverageWindow;
  domainName: string;
  /** DB-editable Stage 1 prompt (engine_a_hot_radar). */
  engineAHotRadarPrompt: string;
  /** DB-editable Stage 2 prompt (shared_deep_dive). */
  sharedDeepDivePrompt: string;
  openRouterApiKey: string;
  /** How many top topics per module to deep-dive. Default 3. */
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
      hotRadarPrompt: input.engineAHotRadarPrompt,
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
