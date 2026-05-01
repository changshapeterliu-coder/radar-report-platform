import type { CoverageWindow } from '../types';
import {
  runEngineLoop,
  type EngineLoopResult,
  type StageRunner,
} from './loop';

/**
 * Engine A — Moonshot Kimi direct with $web_search builtin tool.
 *
 * File name / function name kept as "gemini" to preserve DB column mapping
 * (scheduled_runs.gemini_output) and avoid ripple-refactoring the Inngest
 * function. The actual model running inside is defined below.
 *
 * Historical notes:
 *   - 2026-03: original Engine A was google/gemini-2.0-flash (hence the name).
 *   - 2026-04-12: switched to deepseek/deepseek-v3.2:online via OpenRouter.
 *   - 2026-05-01: switched to Moonshot Kimi direct for native Chinese-site
 *     web search (OpenRouter :online used Exa, which has weak coverage of
 *     小红书 / 抖音 / 雨果网 etc.). Stage 3/4 remain on OpenRouter.
 *
 * Stage timeouts chosen for Vercel Pro Inngest serverless-function limit:
 *   Pro Inngest = 300s / step. We target a conservative 40% headroom.
 *   Stage 1/2 do web search with Moonshot $web_search multi-round tool_calls
 *   and can legitimately need 60-100s (LLM reasoning + Kimi's native search
 *   agent + cross-border network latency from Vercel US to api.moonshot.cn).
 *   Stage 3/4 are pure LLM calls → shorter.
 *
 *   Stage 1  hotRadar        → 240s
 *   Stage 2  deepDive        → 240s (each topic; parallel)
 *   Stage 3  education       → 60s
 *   Stage 4  assembler       → 90s
 */
const DEFAULT_RESEARCHER_MODEL = 'kimi-k2.6'; // Moonshot direct — $web_search enabled
const DEFAULT_MODEL = 'deepseek/deepseek-v3.2'; // OpenRouter for Stage 3/4

export interface GeminiLoopInput {
  coverageWindow: CoverageWindow;
  domainName: string;
  /** DB-editable Stage 1 prompt (engine_a_hot_radar). */
  engineAHotRadarPrompt: string;
  /** DB-editable Stage 2 prompt (shared_deep_dive). */
  sharedDeepDivePrompt: string;
  /** OpenRouter key — used for Stage 3/4 education + assembler. */
  openRouterApiKey: string;
  /** Moonshot key — used for Stage 1/2 research with $web_search. */
  moonshotApiKey: string;
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
      researcherProvider: 'moonshot',
      hotRadarPrompt: input.engineAHotRadarPrompt,
      deepDivePrompt: input.sharedDeepDivePrompt,
      coverageWindow: input.coverageWindow,
      domainName: input.domainName,
      openRouterApiKey: input.openRouterApiKey,
      moonshotApiKey: input.moonshotApiKey,
      deepDivePerModule: input.deepDivePerModule,
      hotRadarTimeoutMs: 240_000,
      deepDiveTimeoutMs: 240_000,
      educationMapperTimeoutMs: 60_000,
      assemblerTimeoutMs: 90_000,
    },
    stageRunner
  );
}
