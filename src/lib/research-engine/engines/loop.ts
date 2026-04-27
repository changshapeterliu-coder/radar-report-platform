import { substitute } from '../substitute';
import {
  PLANNER_PROMPT,
  TOP5_RANKER_PROMPT,
  DEEP_RESEARCHER_PROMPT,
  ENGINE_SUMMARIZER_PROMPT,
} from '../system-prompts';
import {
  CHANNEL_WEIGHT,
  MODULE_KEYS,
  type ChannelType,
  type CoverageWindow,
  type DeepDiveOutput,
  type EngineError,
  type EngineLoopTrace,
  type ModuleKey,
  type Top5Entry,
  type Top5RankerOutput,
} from '../types';
import { callOpenRouter, type ChatMessage } from './openrouter-client';
import { formatDateRange } from '@/lib/inngest/coverage-window';

/** Caller-injected step runner. Default impl = direct call. Inngest injects step.run. */
export type StageRunner = <T>(stageName: string, fn: () => Promise<T>) => Promise<T>;

export const DEFAULT_STAGE_RUNNER: StageRunner = (_name, fn) => fn();

export interface EngineLoopConfig {
  engineLabel: 'gemini' | 'kimi';
  /** Base model used for planner / ranker / summarizer stages (no web search needed). */
  model: string;
  /**
   * Model used for researcher stages (Stage 2 + Stage 4) that need real-time web search.
   * `:online` suffix activates OpenRouter's Exa web-search wrapper.
   */
  researcherModel: string;
  channelProfile: string;
  /** Admin-editable broad researcher prompt (contains {subquestion} placeholder). */
  researcherPrompt: string;
  coverageWindow: CoverageWindow;
  domainName: string;
  openRouterApiKey: string;
  /** Planner subquestion count upper bound (8-12 recommended). */
  maxSubquestionsPerRound: number;
  /** How many top topics per module to deep-dive (typically 3). */
  deepDivePerModule: number;
  plannerTimeoutMs: number;
  broadResearcherTimeoutMs: number;
  top5RankerTimeoutMs: number;
  deepResearcherTimeoutMs: number;
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
  target_module: ModuleKey;
}

interface PlannerOutput {
  subquestions: PlannerSubquestion[];
}

interface BroadFinding {
  title?: string;
  summary?: string;
  module_hint?: ModuleKey;
  severity?: 'high' | 'medium' | 'low';
  quote?: string;
  quote_source?: string;
  source_channel_type?: ChannelType;
}

interface BroadResearcherOutput {
  findings: BroadFinding[];
  citations: string[];
}

/**
 * Runs the 5-stage Top-5-driven research loop for one engine.
 *
 *   Stage 1 — Planner:           8-12 broad subquestions
 *   Stage 2 — Broad Researcher:  parallel web-search (findings w/ channel type)
 *   Stage 3 — Top5 Ranker:       cluster → Voice Volume → Top 5 per module
 *   Stage 4 — Deep Researcher:   one call per (module, top-3 topic)
 *   Stage 5 — Engine Summarizer: assemble per-engine JSON
 *
 * Partial-failure policy:
 *   - Stage 2/4 single researcher failure: recorded in errors; loop continues
 *   - Stage 3 ranker failure: return early with summary=null (no point deep-diving)
 *   - Stage 1/5 failure: entire loop returns summary=null
 */
export async function runEngineLoop(
  config: EngineLoopConfig,
  stageRunner: StageRunner
): Promise<EngineLoopResult> {
  const trace: EngineLoopTrace = {
    plan: null,
    researchRound1: [],
    top5Ranking: null,
    deepDives: [],
    summary: null,
  };
  const errors: EngineError[] = [];

  // Shanghai-local dates for cleaner prompt substitution.
  const humanRange = formatDateRange(
    new Date(config.coverageWindow.startIso),
    new Date(config.coverageWindow.endIso)
  ).split(' ~ ');

  const commonVars = {
    start_date: humanRange[0] ?? config.coverageWindow.startIso,
    end_date: humanRange[1] ?? config.coverageWindow.endIso,
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

  // ── Stage 2: Broad Researchers (parallel) ──
  trace.researchRound1 = await runBroadResearch(
    config,
    commonVars,
    subquestions,
    stageRunner,
    errors
  );

  // ── Stage 3: Top 5 Ranker ──
  const rankerResult = await stageRunner('stage3-top5-ranker', () =>
    callTop5Ranker(config, commonVars, trace.researchRound1)
  );
  if (!rankerResult.ok) {
    errors.push(rankerResult.error);
    return { trace, summary: null, errors };
  }
  trace.top5Ranking = rankerResult.data;

  // ── Stage 4: Deep Researchers (parallel — one per top-3 topic per module) ──
  trace.deepDives = await runDeepResearch(
    config,
    commonVars,
    rankerResult.data,
    stageRunner,
    errors
  );

  // ── Stage 5: Engine Summarizer ──
  const summaryResult = await stageRunner('stage5-summarize', () =>
    callEngineSummarizer(config, commonVars, rankerResult.data, trace.deepDives)
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
    { role: 'user', content: '请返回 JSON 格式的规划结果。' },
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

async function runBroadResearch(
  config: EngineLoopConfig,
  vars: StageCommonVars,
  subquestions: PlannerSubquestion[],
  stageRunner: StageRunner,
  errors: EngineError[]
): Promise<EngineLoopTrace['researchRound1']> {
  const promises = subquestions.map((sq, idx) =>
    stageRunner(`stage2-research-${idx + 1}`, async () => {
      const researcherPromptResolved = substitute(config.researcherPrompt, {
        ...vars,
        subquestion: sq.text,
      });
      const messages: ChatMessage[] = [
        { role: 'system', content: researcherPromptResolved },
        { role: 'user', content: `请针对以下子问题研究：${sq.text}` },
      ];
      const result = await callOpenRouter<BroadResearcherOutput>({
        model: config.researcherModel,
        messages,
        apiKey: config.openRouterApiKey,
        timeoutMs: config.broadResearcherTimeoutMs,
        jsonMode: true,
        errorContext: {
          engine: config.engineLabel,
          stage: 'researcher',
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

async function callTop5Ranker(
  config: EngineLoopConfig,
  vars: StageCommonVars,
  round1: EngineLoopTrace['researchRound1']
): Promise<
  | { ok: true; data: Top5RankerOutput }
  | { ok: false; error: EngineError }
> {
  // Flatten every finding; include subquestion context for the LLM's clustering.
  const findingsInput = round1
    .filter((r) => r.findings !== null)
    .map((r, i) => {
      const output = r.findings as BroadResearcherOutput;
      return `子问题 ${i + 1}：${r.subquestion}\nFindings: ${JSON.stringify(output.findings ?? [])}`;
    })
    .join('\n\n');

  const systemPrompt = substitute(TOP5_RANKER_PROMPT, vars).replace(
    '{findings_input}',
    findingsInput || '(没有可用 findings)'
  );

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '请返回 JSON 格式的 Top 5 排名。' },
  ];
  const raw = await callOpenRouter<{ modules?: Record<string, unknown> }>({
    model: config.model,
    messages,
    apiKey: config.openRouterApiKey,
    timeoutMs: config.top5RankerTimeoutMs,
    jsonMode: true,
    errorContext: { engine: config.engineLabel, stage: 'top5-ranker' },
  });
  if (!raw.ok) return raw;

  const normalized = normalizeTop5Ranker(raw.data);
  if (!normalized.ok) {
    return {
      ok: false,
      error: {
        engine: config.engineLabel,
        stage: 'top5-ranker',
        errorClass: 'MalformedResponse',
        message: normalized.reason,
      },
    };
  }
  return { ok: true, data: normalized.data };
}

async function runDeepResearch(
  config: EngineLoopConfig,
  vars: StageCommonVars,
  ranking: Top5RankerOutput,
  stageRunner: StageRunner,
  errors: EngineError[]
): Promise<DeepDiveOutput[]> {
  // Gather (module, topTopic) tuples for the top N per module (N = deepDivePerModule).
  const targets: Array<{ module: ModuleKey; entry: Top5Entry }> = [];
  for (const mod of MODULE_KEYS) {
    const entries = ranking.modules[mod] ?? [];
    for (const entry of entries.slice(0, config.deepDivePerModule)) {
      targets.push({ module: mod, entry });
    }
  }

  const promises = targets.map(({ module, entry }, idx) =>
    stageRunner(`stage4-deep-${idx + 1}`, async () => {
      const systemPrompt = substitute(DEEP_RESEARCHER_PROMPT, {
        ...vars,
        topic: entry.topic,
        module,
        keywords: entry.keywords.join('、'),
      });
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `请针对 topic "${entry.topic}" 在 module "${module}" 下深挖卖家声音，返回 JSON。`,
        },
      ];
      const result = await callOpenRouter<unknown>({
        model: config.researcherModel,
        messages,
        apiKey: config.openRouterApiKey,
        timeoutMs: config.deepResearcherTimeoutMs,
        jsonMode: true,
        errorContext: {
          engine: config.engineLabel,
          stage: 'deep-researcher',
          subquestionIndex: idx + 1,
        },
      });
      if (!result.ok) {
        errors.push(result.error);
        // Return a thin fallback so downstream summarizer knows the topic was attempted.
        return {
          topic: entry.topic,
          module,
          narrative: '',
          painpoints: [],
          quotes: [],
          cases: [],
        } satisfies DeepDiveOutput;
      }
      return normalizeDeepDive(result.data, entry.topic, module);
    })
  );
  return Promise.all(promises);
}

async function callEngineSummarizer(
  config: EngineLoopConfig,
  vars: StageCommonVars,
  ranking: Top5RankerOutput,
  deepDives: DeepDiveOutput[]
): Promise<{ ok: true; data: unknown } | { ok: false; error: EngineError }> {
  const top5Input = JSON.stringify(ranking);
  const deepDivesInput = JSON.stringify(deepDives);

  const systemPrompt = substitute(ENGINE_SUMMARIZER_PROMPT, vars)
    .replace('{top5_input}', top5Input)
    .replace('{deep_dives_input}', deepDivesInput);

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '请返回 JSON 格式的整合结果。' },
  ];
  return callOpenRouter<unknown>({
    model: config.model,
    messages,
    apiKey: config.openRouterApiKey,
    timeoutMs: config.engineSummarizerTimeoutMs,
    jsonMode: true,
    errorContext: { engine: config.engineLabel, stage: 'engine-summarizer' },
  });
}

// ==========================================================
// Output normalizers (defensive — LLMs misbehave on schema)
// ==========================================================

function normalizeTop5Ranker(
  raw: unknown
):
  | { ok: true; data: Top5RankerOutput }
  | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'ranker output is not an object' };
  }
  const rec = raw as Record<string, unknown>;
  const modulesRaw = rec.modules;
  if (!modulesRaw || typeof modulesRaw !== 'object') {
    return { ok: false, reason: 'ranker output missing modules object' };
  }
  const modulesInput = modulesRaw as Record<string, unknown>;

  const modules: Record<ModuleKey, Top5Entry[]> = {
    suspension: [],
    listing: [],
    tool_feedback: [],
    education: [],
  };
  for (const mod of MODULE_KEYS) {
    const arr = modulesInput[mod];
    if (!Array.isArray(arr)) continue;
    modules[mod] = arr
      .slice(0, 5) // Enforce Top 5 ceiling defensively.
      .map((item, i) => normalizeTop5Entry(item, i + 1))
      .filter((e): e is Top5Entry => e !== null);
  }
  return { ok: true, data: { modules } };
}

function normalizeTop5Entry(raw: unknown, defaultRank: number): Top5Entry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const topic = typeof r.topic === 'string' ? r.topic.trim() : '';
  if (!topic) return null;
  const keywordsRaw = Array.isArray(r.keywords) ? r.keywords : [];
  const keywords = keywordsRaw
    .filter((k): k is string => typeof k === 'string')
    .slice(0, 5);
  const severityRaw = r.severity;
  const severity: 'high' | 'medium' | 'low' =
    severityRaw === 'high' || severityRaw === 'low' ? severityRaw : 'medium';
  // Recompute voice_volume from channel_counts defensively; if the LLM's
  // pre-computed value disagrees with the weighted sum we trust the latter.
  const channelCountsRaw =
    r.channel_counts && typeof r.channel_counts === 'object'
      ? (r.channel_counts as Record<string, unknown>)
      : {};
  const channelCounts: Partial<Record<ChannelType, number>> = {};
  let computedVolume = 0;
  for (const ch of Object.keys(CHANNEL_WEIGHT) as ChannelType[]) {
    const rawCount = channelCountsRaw[ch];
    const count = typeof rawCount === 'number' && rawCount >= 0 ? rawCount : 0;
    if (count > 0) {
      channelCounts[ch] = count;
      computedVolume += count * CHANNEL_WEIGHT[ch];
    }
  }
  const llmVolume =
    typeof r.voice_volume === 'number' ? r.voice_volume : computedVolume;
  const voiceVolume = Number(
    (computedVolume > 0 ? computedVolume : llmVolume).toFixed(1)
  );
  return {
    rank: typeof r.rank === 'number' ? r.rank : defaultRank,
    topic,
    voice_volume: voiceVolume,
    keywords,
    seller_discussion:
      typeof r.seller_discussion === 'string' ? r.seller_discussion : '',
    severity,
    channel_counts: channelCounts,
  };
}

function normalizeDeepDive(
  raw: unknown,
  expectedTopic: string,
  expectedModule: ModuleKey
): DeepDiveOutput {
  const empty: DeepDiveOutput = {
    topic: expectedTopic,
    module: expectedModule,
    narrative: '',
    painpoints: [],
    quotes: [],
    cases: [],
  };
  if (!raw || typeof raw !== 'object') return empty;
  const r = raw as Record<string, unknown>;
  const narrative = typeof r.narrative === 'string' ? r.narrative : '';
  const painpoints = Array.isArray(r.painpoints)
    ? r.painpoints.filter((p): p is string => typeof p === 'string').slice(0, 5)
    : [];
  const quotes = Array.isArray(r.quotes)
    ? r.quotes
        .filter(
          (q): q is { quote: string; source: string } =>
            !!q &&
            typeof (q as { quote?: unknown }).quote === 'string' &&
            typeof (q as { source?: unknown }).source === 'string'
        )
        .slice(0, 4)
    : [];
  const cases = Array.isArray(r.cases)
    ? (r.cases as unknown[])
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c) => ({
          title: typeof c.title === 'string' ? c.title : undefined,
          content: typeof c.content === 'string' ? c.content : '',
          meta: typeof c.meta === 'string' ? c.meta : undefined,
        }))
        .filter((c) => c.content.length > 0)
        .slice(0, 4)
    : [];
  const recommendation =
    typeof r.recommendation === 'string' && r.recommendation.trim().length > 0
      ? r.recommendation
      : undefined;
  return {
    topic: typeof r.topic === 'string' && r.topic.trim() ? r.topic : expectedTopic,
    module:
      r.module === 'suspension' ||
      r.module === 'listing' ||
      r.module === 'tool_feedback' ||
      r.module === 'education'
        ? r.module
        : expectedModule,
    narrative,
    painpoints,
    quotes,
    cases,
    recommendation,
  };
}
