import type { CoverageWindow } from '../types';
import {
  runEngineLoop,
  type EngineLoopResult,
  type StageRunner,
} from './loop';

/**
 * Engine B — Zhipu GLM (glm-4.6) direct via z.ai with web_search tool.
 *
 * File name / function name kept as "kimi" to preserve DB column mapping
 * (scheduled_runs.kimi_output). The actual model running inside is defined
 * below.
 *
 * Historical notes:
 *   - 2026-03 to 2026-04: Moonshot Kimi K2 via OpenRouter :online (Exa search).
 *   - 2026-05-01 AM: switched Engine A to Moonshot direct (PR 1) for native
 *     CN search; Engine B kept on OpenRouter :online as a transition.
 *   - 2026-05-01 PM: switched Engine B to Alibaba Qwen direct for true
 *     heterogeneous cross-engine confirmation. Unfortunately DashScope's
 *     "non-streaming + web_search + thinking-mode" combination rejects with
 *     HTTP 400 at runtime regardless of documented defaults; 5 workarounds
 *     attempted across models (qwen3-max, qwen-plus, qwen3.5-plus) all
 *     failed in production.
 *   - 2026-05-02 (this PR): swapped Engine B from Qwen to Zhipu GLM-4.6 via
 *     z.ai. GLM has no equivalent restriction on response_format + web_search
 *     in a single call, so the two-step Qwen workaround collapses back to
 *     one HTTP round-trip. Explicit `thinking: { type: 'disabled' }` is set
 *     on every call as belt-and-suspenders against the same class of trap.
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
 * Engine B researcher model — Zhipu GLM direct via z.ai, web_search enabled.
 *
 * Why glm-4.6 (over glm-4.5-air cheaper tier or glm-4.7 / glm-5.1 newer):
 *
 *   • Zhipu positions glm-4.6 explicitly as a "tool using and search-based
 *     agents" workhorse — exactly our Stage 1/2 profile.
 *   • Released 2025-09; ~6 months of production hardening before we adopt.
 *     The Qwen cycle taught that "just released" models have runtime surprises
 *     even when docs look correct; avoid the same trap.
 *   • Same price tier as 4.7 / 5.1 per z.ai pricing page; "go latest" offers
 *     no cost advantage and trades proven behavior for marginal capability
 *     gains we don't need.
 *   • One-line upgrade path to a newer SKU if quality proves insufficient —
 *     change this constant only.
 *
 *   Refs:
 *     https://docs.z.ai/guides/tools/web-search
 *     https://docs.z.ai/guides/llm/glm-4.6
 */
const DEFAULT_RESEARCHER_MODEL = 'glm-4.6';
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
  /** z.ai (Zhipu) key — used for Stage 1/2 research via callZai. */
  zaiApiKey: string;
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
      researcherProvider: 'zai',
      hotRadarPrompt: input.engineBHotRadarPrompt,
      deepDivePrompt: input.sharedDeepDivePrompt,
      coverageWindow: input.coverageWindow,
      domainName: input.domainName,
      openRouterApiKey: input.openRouterApiKey,
      zaiApiKey: input.zaiApiKey,
      deepDivePerModule: input.deepDivePerModule,
      hotRadarTimeoutMs: 240_000,
      deepDiveTimeoutMs: 240_000,
      educationMapperTimeoutMs: 60_000,
      assemblerTimeoutMs: 90_000,
    },
    stageRunner
  );
}
