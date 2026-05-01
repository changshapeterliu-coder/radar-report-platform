import type { CoverageWindow } from '../types';
import {
  runEngineLoop,
  type EngineLoopResult,
  type StageRunner,
} from './loop';

/**
 * Engine B — Alibaba Qwen direct via DashScope with enable_search.
 *
 * File name / function name kept as "kimi" to preserve DB column mapping
 * (scheduled_runs.kimi_output). The actual model running inside is defined
 * below.
 *
 * Historical notes:
 *   - 2026-03 to 2026-04: Moonshot Kimi K2 via OpenRouter :online (Exa search).
 *   - 2026-05-01 AM: switched Engine A to Moonshot direct (PR 1) for native
 *     CN search; Engine B kept on OpenRouter :online as a transition.
 *   - 2026-05-01 PM: switched Engine B to Alibaba Qwen direct (this PR) for
 *     true heterogeneous cross-engine confirmation — Qwen's 夸克 search has
 *     strong coverage of the e-commerce / 1688 / Taobao ecosystem,
 *     complementing Moonshot's deeper social / 小红书 / 知乎 coverage.
 *
 * Stage timeouts aligned to Vercel Pro Inngest 300s serverless-function
 * limit (same as Engine A), with 40% headroom:
 *
 *   Stage 1  hotRadar        → 240s
 *   Stage 2  deepDive        → 240s (per topic; parallel)
 *   Stage 3  education       → 60s
 *   Stage 4  assembler       → 90s
 */
/**
 * Engine B researcher model — Alibaba DashScope direct, enable_search enabled.
 *
 * Why qwen3.5-plus (not qwen3-max):
 *   qwen3-max runs in "thinking mode" by default. Alibaba's API rejects
 *   enable_search + non-streaming + thinking mode together with a 400:
 *     'Non-streaming mode does not support Web Search in thinking mode'
 *   qwen3.5-plus is a non-thinking model that fully supports enable_search
 *   in regular (non-streaming) mode, which is what our serverless setup uses.
 *   For the search + top-N extraction task we're doing, qwen3.5-plus is
 *   more than capable; we don't need thinking-tier reasoning.
 */
const DEFAULT_RESEARCHER_MODEL = 'qwen3.5-plus';
const DEFAULT_MODEL = 'moonshotai/kimi-k2-0905'; // OpenRouter for Stage 3/4

export interface KimiLoopInput {
  coverageWindow: CoverageWindow;
  domainName: string;
  /** DB-editable Stage 1 prompt (engine_b_hot_radar). */
  engineBHotRadarPrompt: string;
  /** DB-editable Stage 2 prompt (shared_deep_dive). */
  sharedDeepDivePrompt: string;
  /** OpenRouter key — used for Stage 3/4 education + assembler. */
  openRouterApiKey: string;
  /** DashScope (Alibaba) key — used for Stage 1/2 research with enable_search. */
  qwenApiKey: string;
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
      researcherProvider: 'qwen',
      hotRadarPrompt: input.engineBHotRadarPrompt,
      deepDivePrompt: input.sharedDeepDivePrompt,
      coverageWindow: input.coverageWindow,
      domainName: input.domainName,
      openRouterApiKey: input.openRouterApiKey,
      qwenApiKey: input.qwenApiKey,
      deepDivePerModule: input.deepDivePerModule,
      hotRadarTimeoutMs: 240_000,
      deepDiveTimeoutMs: 240_000,
      educationMapperTimeoutMs: 60_000,
      assemblerTimeoutMs: 90_000,
    },
    stageRunner
  );
}
