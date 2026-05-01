import type { CoverageWindow } from '../types';
import {
  runEngineLoop,
  type EngineLoopResult,
  type StageRunner,
} from './loop';

/**
 * Engine B — currently Moonshot Kimi K2 via OpenRouter :online suffix.
 *
 * File name kept as "kimi" to preserve DB column mapping
 * (scheduled_runs.kimi_output).
 *
 * PLANNED: switch to Alibaba Qwen direct with enable_search for native
 * Chinese-site coverage (夸克 search ecosystem). Tracked as PR 2 in the
 * 2026-05 engine-provider refactor. Until then this engine still uses
 * OpenRouter + Exa which has weak Chinese community coverage — the
 * cross-engine value is limited until PR 2 lands.
 *
 * Stage timeouts aligned to Vercel Pro 60s serverless-function limit
 * (same as Engine A). Previously was 4 minutes which silently exceeded
 * the platform cap.
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
      researcherProvider: 'openrouter',
      hotRadarPrompt: input.engineBHotRadarPrompt,
      deepDivePrompt: input.sharedDeepDivePrompt,
      coverageWindow: input.coverageWindow,
      domainName: input.domainName,
      openRouterApiKey: input.openRouterApiKey,
      deepDivePerModule: input.deepDivePerModule,
      hotRadarTimeoutMs: 50_000,
      deepDiveTimeoutMs: 50_000,
      educationMapperTimeoutMs: 30_000,
      assemblerTimeoutMs: 40_000,
    },
    stageRunner
  );
}
