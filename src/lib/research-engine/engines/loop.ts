import { substitute } from '../substitute';
import {
  PLANNER_PROMPT,
  GAP_ANALYZER_PROMPT,
  ENGINE_SUMMARIZER_PROMPT,
} from '../system-prompts';
import type {
  CoverageWindow,
  EngineError,
  EngineLoopTrace,
} from '../types';
import { callOpenRouter, type ChatMessage } from './openrouter-client';

/** Caller-injected step runner. Default impl = direct call. Inngest injects step.run. */
export type StageRunner = <T>(stageName: string, fn: () => Promise<T>) => Promise<T>;

export const DEFAULT_STAGE_RUNNER: StageRunner = (_name, fn) => fn();

export interface EngineLoopConfig {
  engineLabel: 'gemini' | 'kimi';
  /** Base model used for planner / gap-analyzer / engine-summarizer stages (no web search needed). */
  model: string;
  /**
   * Model used for researcher stages (stage 2 + stage 4) that need real-time web search.
   * OpenRouter's `:online` suffix auto-adds Exa web search to any model:
   * the service runs a search, injects results into context, then calls the model.
   * See https://openrouter.ai/docs/features/web-search for pricing (+$0.004/request).
   */
  researcherModel: string;
  channelProfile: string;
  /** Admin-editable researcher prompt (contains {subquestion} placeholder). */
  researcherPrompt: string;
  coverageWindow: CoverageWindow;
  domainName: string;
  openRouterApiKey: string;
  maxSubquestionsPerRound: number;
  maxGapSubquestions: number;
  plannerTimeoutMs: number;
  researcherTimeoutMs: number;
  gapAnalyzerTimeoutMs: number;
  engineSummarizerTimeoutMs: number;
}

export interface EngineLoopResult {
  /** Full trace of every stage — what "View Logs" drawer renders. */
  trace: EngineLoopTrace;
  /** Structured summary returned by engine-summarizer. Null if loop failed. */
  summary: unknown | null;
  /** All errors encountered during the loop (stage-level + subquestion-level). */
  errors: EngineError[];
}

interface PlannerSubquestion {
  text: string;
  search_intent: string;
  target_module: 'suspension' | 'listing' | 'tool_feedback' | 'education';
}

interface PlannerOutput {
  subquestions: PlannerSubquestion[];
}

interface ResearcherOutput {
  findings: unknown[];
  citations: string[];
}

interface GapAnalyzerOutput {
  sufficient: boolean;
  gaps: Array<{ text: string; rationale: string }>;
}

/**
 * Runs a full 5-stage agentic research loop for one engine.
 *
 * Stages:
 *   1. Planner (1 LLM call) → 5-8 subquestions
 *   2. Researcher (N parallel LLM calls, web search enabled)
 *   3. Gap analyzer (1 LLM call) → optional follow-up subquestions
 *   4. Deeper researcher (0-M parallel, conditional on gaps)
 *   5. Engine summarizer (1 LLM call) → structured module-grouped summary
 *
 * Partial-failure policy:
 *   - Stage 2/4 single researcher failure: records error, keeps looping
 *   - Stage 3 gap analyzer failure: degrades to "sufficient=true", skips Stage 4
 *   - Stage 1/5 failure: entire loop returns summary=null
 */
export async function runEngineLoop(
  config: EngineLoopConfig,
  stageRunner: StageRunner
): Promise<EngineLoopResult> {
  const trace: EngineLoopTrace = {
    plan: null,
    researchRound1: [],
    gapAnalysis: null,
    researchRound2: [],
    summary: null,
  };
  const errors: EngineError[] = [];

  const commonVars = {
    start_date: config.coverageWindow.startIso,
    end_date: config.coverageWindow.endIso,
    week_label: config.coverageWindow.weekLabel,
    domain_name: config.domainName,
    channel_profile: config.channelProfile,
  };

  // ── Stage 1: Planner ──
  const planResult = await stageRunner('stage1-plan', () =>
    callPlanner(config, commonVars)
  );
  if (!planResult.ok) {
    errors.push(planResult.error);
    return { trace, summary: null, errors };
  }
  trace.plan = planResult.data;
  const subquestions = planResult.data.subquestions;

  // ── Stage 2: Researchers (parallel) ──
  trace.researchRound1 = await runResearchBatch(
    config,
    commonVars,
    subquestions,
    stageRunner,
    'stage2-research',
    errors
  );

  // ── Stage 3: Gap analyzer (degrade gracefully on failure) ──
  const gapResult = await stageRunner('stage3-gap-analysis', () =>
    callGapAnalyzer(config, commonVars, trace.researchRound1)
  );
  if (gapResult.ok) {
    trace.gapAnalysis = gapResult.data;
  } else {
    errors.push(gapResult.error);
    // Degrade: treat as sufficient so we skip Stage 4.
    trace.gapAnalysis = { sufficient: true, gaps: [] } satisfies GapAnalyzerOutput;
  }
  const gapOutput = trace.gapAnalysis as GapAnalyzerOutput;

  // ── Stage 4: Deeper researchers (conditional, parallel) ──
  if (!gapOutput.sufficient && gapOutput.gaps.length > 0) {
    // Enforce maxGapSubquestions ceiling (Property 30: truncate if LLM over-returned).
    const capped = gapOutput.gaps.slice(0, config.maxGapSubquestions);
    const gapSubquestions: PlannerSubquestion[] = capped.map((g) => ({
      text: g.text,
      search_intent: g.rationale,
      // Best-effort routing: gap analyzer doesn't tag modules; researcher prompt
      // doesn't need target_module since the researcher itself emits module_hint.
      target_module: 'suspension',
    }));
    trace.researchRound2 = await runResearchBatch(
      config,
      commonVars,
      gapSubquestions,
      stageRunner,
      'stage4-deeper',
      errors
    );
  }

  // ── Stage 5: Engine summarizer ──
  const summaryResult = await stageRunner('stage5-summarize', () =>
    callEngineSummarizer(config, commonVars, [
      ...trace.researchRound1,
      ...trace.researchRound2,
    ])
  );
  if (summaryResult.ok) {
    trace.summary = summaryResult.data;
    return { trace, summary: summaryResult.data, errors };
  }
  errors.push(summaryResult.error);
  return { trace, summary: null, errors };
}

// ==========================================================
// Stage implementations
// ==========================================================

type StageCommonVars = Record<
  'start_date' | 'end_date' | 'week_label' | 'domain_name' | 'channel_profile',
  string
>;

async function callPlanner(
  config: EngineLoopConfig,
  vars: StageCommonVars
): Promise<{ ok: true; data: PlannerOutput } | { ok: false; error: EngineError }> {
  const systemPrompt = substitute(PLANNER_PROMPT, vars);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Produce the plan as JSON.' },
  ];
  const raw = await callOpenRouter<PlannerOutput>({
    model: config.model,
    messages,
    apiKey: config.openRouterApiKey,
    timeoutMs: config.plannerTimeoutMs,
    jsonMode: true,
    errorContext: { engine: config.engineLabel, stage: 'planner' },
  });
  if (!raw.ok) return raw;

  const data = raw.data;
  if (
    !data ||
    !Array.isArray(data.subquestions) ||
    data.subquestions.length < 5 ||
    data.subquestions.length > config.maxSubquestionsPerRound
  ) {
    return {
      ok: false,
      error: {
        engine: config.engineLabel,
        stage: 'planner',
        errorClass: 'MalformedResponse',
        message: `Planner returned ${data?.subquestions?.length ?? 0} subquestions (expected 5-${config.maxSubquestionsPerRound})`,
      },
    };
  }
  return { ok: true, data };
}

async function runResearchBatch(
  config: EngineLoopConfig,
  vars: StageCommonVars,
  subquestions: PlannerSubquestion[],
  stageRunner: StageRunner,
  stageNamePrefix: string,
  errors: EngineError[]
): Promise<EngineLoopTrace['researchRound1']> {
  const stage: 'researcher' | 'deeper-researcher' =
    stageNamePrefix === 'stage4-deeper' ? 'deeper-researcher' : 'researcher';

  const promises = subquestions.map((sq, idx) =>
    stageRunner(`${stageNamePrefix}-${idx + 1}`, async () => {
      const researcherPromptResolved = substitute(config.researcherPrompt, {
        ...vars,
        subquestion: sq.text,
      });
      const messages: ChatMessage[] = [
        { role: 'system', content: researcherPromptResolved },
        { role: 'user', content: `Research this subquestion: ${sq.text}` },
      ];
      const result = await callOpenRouter<ResearcherOutput>({
        model: config.researcherModel,
        messages,
        apiKey: config.openRouterApiKey,
        timeoutMs: config.researcherTimeoutMs,
        jsonMode: true,
        errorContext: {
          engine: config.engineLabel,
          stage,
          subquestionIndex: idx + 1,
        },
      });
      if (!result.ok) {
        errors.push(result.error);
        return { subquestion: sq.text, findings: null };
      }
      return { subquestion: sq.text, findings: result.data };
    })
  );
  return Promise.all(promises);
}

async function callGapAnalyzer(
  config: EngineLoopConfig,
  vars: StageCommonVars,
  round1: EngineLoopTrace['researchRound1']
): Promise<{ ok: true; data: GapAnalyzerOutput } | { ok: false; error: EngineError }> {
  const findingsSummary = round1
    .filter((r) => r.findings !== null)
    .map((r, i) => `Subquestion ${i + 1}: ${r.subquestion}\nFindings: ${JSON.stringify(r.findings)}`)
    .join('\n\n');

  const systemPrompt = substitute(GAP_ANALYZER_PROMPT, {
    ...vars,
    // Custom vars inline — GAP_ANALYZER_PROMPT has {findings_summary} and {max_gap_subquestions}
    // which aren't in our allowed-key list. Do a second pass with simple replace for these two.
  });
  // Second-pass replace for analyzer-specific tokens (safe — only hardcoded keys).
  const fullPrompt = systemPrompt
    .replace('{findings_summary}', findingsSummary || '(no findings yet)')
    .replace(
      '{max_gap_subquestions}',
      String(config.maxGapSubquestions)
    );

  const messages: ChatMessage[] = [
    { role: 'system', content: fullPrompt },
    { role: 'user', content: 'Evaluate gaps and return JSON.' },
  ];
  const raw = await callOpenRouter<GapAnalyzerOutput>({
    model: config.model,
    messages,
    apiKey: config.openRouterApiKey,
    timeoutMs: config.gapAnalyzerTimeoutMs,
    jsonMode: true,
    errorContext: { engine: config.engineLabel, stage: 'gap-analyzer' },
  });
  if (!raw.ok) return raw;

  const data = raw.data;
  if (
    !data ||
    typeof data.sufficient !== 'boolean' ||
    !Array.isArray(data.gaps)
  ) {
    return {
      ok: false,
      error: {
        engine: config.engineLabel,
        stage: 'gap-analyzer',
        errorClass: 'MalformedResponse',
        message: 'Gap analyzer returned malformed JSON (missing sufficient/gaps)',
      },
    };
  }
  return { ok: true, data };
}

async function callEngineSummarizer(
  config: EngineLoopConfig,
  vars: StageCommonVars,
  allBatches: EngineLoopTrace['researchRound1']
): Promise<{ ok: true; data: unknown } | { ok: false; error: EngineError }> {
  const batchesText = allBatches
    .filter((b) => b.findings !== null)
    .map((b, i) => `Batch ${i + 1} (sq: ${b.subquestion}):\n${JSON.stringify(b.findings)}`)
    .join('\n\n');

  const systemPrompt = substitute(ENGINE_SUMMARIZER_PROMPT, vars).replace(
    '{findings_batches}',
    batchesText || '(no findings)'
  );
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Produce the structured summary as JSON.' },
  ];
  const raw = await callOpenRouter<unknown>({
    model: config.model,
    messages,
    apiKey: config.openRouterApiKey,
    timeoutMs: config.engineSummarizerTimeoutMs,
    jsonMode: true,
    errorContext: { engine: config.engineLabel, stage: 'engine-summarizer' },
  });
  return raw;
}
