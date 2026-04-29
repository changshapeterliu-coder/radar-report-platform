import { substitute } from '../substitute';
import {
  EDUCATION_MAPPER_PROMPT,
  ASSEMBLER_PROMPT,
} from '../system-prompts';
import {
  HOT_RADAR_MODULE_KEYS,
  type CoverageWindow,
  type DeepDiveOutput,
  type EducationOpportunity,
  type EngineAssembledContent,
  type EngineError,
  type EngineLoopTrace,
  type HotRadarOutput,
  type HotRadarModuleKey,
  type HotRadarTopic,
  type ToolFeedbackItem,
} from '../types';
import { callOpenRouter, type ChatMessage } from './openrouter-client';
import { formatDateRange } from '@/lib/inngest/coverage-window';

/** Caller-injected step runner. Default impl = direct call. Inngest injects step.run. */
export type StageRunner = <T>(stageName: string, fn: () => Promise<T>) => Promise<T>;

export const DEFAULT_STAGE_RUNNER: StageRunner = (_name, fn) => fn();

export interface EngineLoopConfig {
  engineLabel: 'gemini' | 'kimi';
  /** Base model used for Stage 3/4 (no web search). */
  model: string;
  /** Model used for Stage 1/2 with :online web search. */
  researcherModel: string;
  /** Stage 1 prompt (DB-editable, engine-specific). */
  hotRadarPrompt: string;
  /** Stage 2 prompt (DB-editable, shared by both engines). */
  deepDivePrompt: string;
  coverageWindow: CoverageWindow;
  domainName: string;
  openRouterApiKey: string;
  /** Top-N topics per module to deep-dive. Default 3. */
  deepDivePerModule: number;
  hotRadarTimeoutMs: number;
  deepDiveTimeoutMs: number;
  educationMapperTimeoutMs: number;
  assemblerTimeoutMs: number;
}

export interface EngineLoopResult {
  /** Full trace of every stage — what "View Logs" drawer renders. */
  trace: EngineLoopTrace;
  /** Assembled per-engine ReportContent (null if any stage failed). */
  assembled: EngineAssembledContent | null;
  /** All errors encountered during the loop (stage-level + topic-level). */
  errors: EngineError[];
}

/**
 * Runs the 4-stage hot-radar-driven research loop for one engine.
 *
 *   Stage 1 — Hot Radar Scan:    1 online search; returns Top N per module + tool feedback
 *   Stage 2 — Deep Dive:         parallel online searches, one per Top-3 topic
 *   Stage 3 — Education Mapper:  pure LLM; reverse-infers education opportunities
 *   Stage 4 — Assembler:         pure LLM; assembles EngineAssembledContent
 *
 * Partial-failure policy:
 *   - Stage 1 fails → entire loop returns assembled=null
 *   - Stage 2 single topic fails → recorded in errors; loop continues
 *   - Stage 3 fails → education_opportunities = []; loop continues
 *   - Stage 4 fails → assembled=null; trace still captures what we had
 */
export async function runEngineLoop(
  config: EngineLoopConfig,
  stageRunner: StageRunner
): Promise<EngineLoopResult> {
  const trace: EngineLoopTrace = {
    hotRadar: null,
    deepDives: [],
    educationOpportunities: [],
    assembled: null,
  };
  const errors: EngineError[] = [];

  const humanRange = formatDateRange(
    new Date(config.coverageWindow.startIso),
    new Date(config.coverageWindow.endIso)
  ).split(' ~ ');

  const commonVars = {
    start_date: humanRange[0] ?? config.coverageWindow.startIso,
    end_date: humanRange[1] ?? config.coverageWindow.endIso,
    week_label: config.coverageWindow.weekLabel,
    domain_name: config.domainName,
  };

  // ── Stage 1: Hot Radar Scan ──
  const hotRadarResult = await stageRunner('stage1-hot-radar', () =>
    callHotRadar(config, commonVars)
  );
  if (!hotRadarResult.ok) {
    errors.push(hotRadarResult.error);
    return { trace, assembled: null, errors };
  }
  trace.hotRadar = hotRadarResult.data;

  // ── Stage 2: Deep Dive (parallel, Top N per module) ──
  trace.deepDives = await runDeepDives(
    config,
    commonVars,
    hotRadarResult.data,
    stageRunner,
    errors
  );

  // ── Stage 3: Education Opportunity Mapper ──
  const eduResult = await stageRunner('stage3-education-mapper', () =>
    callEducationMapper(config, commonVars, hotRadarResult.data, trace.deepDives)
  );
  if (eduResult.ok) {
    trace.educationOpportunities = eduResult.data;
  } else {
    errors.push(eduResult.error);
    // Non-fatal: Stage 4 can still assemble without education tab.
  }

  // ── Stage 4: Assembler ──
  const assembleResult = await stageRunner('stage4-assembler', () =>
    callAssembler(
      config,
      commonVars,
      hotRadarResult.data,
      trace.deepDives,
      trace.educationOpportunities
    )
  );
  if (assembleResult.ok) {
    trace.assembled = assembleResult.data;
    return { trace, assembled: assembleResult.data, errors };
  }
  errors.push(assembleResult.error);
  return { trace, assembled: null, errors };
}

// ==========================================================
// Stage 1 — Hot Radar Scan
// ==========================================================

type StageCommonVars = Record<
  'start_date' | 'end_date' | 'week_label' | 'domain_name',
  string
>;

async function callHotRadar(
  config: EngineLoopConfig,
  vars: StageCommonVars
): Promise<
  { ok: true; data: HotRadarOutput } | { ok: false; error: EngineError }
> {
  const systemPrompt = substitute(config.hotRadarPrompt, vars);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: '请按 system 指令做一次综合 web search，输出 JSON。',
    },
  ];
  const raw = await callOpenRouter<unknown>({
    model: config.researcherModel,
    messages,
    apiKey: config.openRouterApiKey,
    timeoutMs: config.hotRadarTimeoutMs,
    jsonMode: true,
    errorContext: { engine: config.engineLabel, stage: 'hot-radar-scan' },
  });
  if (!raw.ok) return raw;

  const normalized = normalizeHotRadar(raw.data);
  if (!normalized.ok) {
    return {
      ok: false,
      error: {
        engine: config.engineLabel,
        stage: 'hot-radar-scan',
        errorClass: 'MalformedResponse',
        message: normalized.reason,
      },
    };
  }
  return { ok: true, data: normalized.data };
}

// ==========================================================
// Stage 2 — Deep Dive (parallel, per Top-N topic)
// ==========================================================

async function runDeepDives(
  config: EngineLoopConfig,
  vars: StageCommonVars,
  hotRadar: HotRadarOutput,
  stageRunner: StageRunner,
  errors: EngineError[]
): Promise<DeepDiveOutput[]> {
  // Build the (module, topic) target list: top-N from each module.
  const targets: Array<{ module: HotRadarModuleKey; topic: HotRadarTopic }> = [];
  for (const mod of HOT_RADAR_MODULE_KEYS) {
    const topics =
      mod === 'account_health'
        ? hotRadar.account_health_topics
        : hotRadar.listing_topics;
    for (const topic of topics.slice(0, config.deepDivePerModule)) {
      targets.push({ module: mod, topic });
    }
  }

  const promises = targets.map(({ module, topic }, idx) =>
    stageRunner(`stage2-deep-dive-${idx + 1}`, async () => {
      const topicInput = JSON.stringify({
        topic: topic.topic,
        keywords: topic.keywords,
        channels_observed: topic.channels_observed,
        initial_evidence: topic.initial_evidence,
        initial_misconception: topic.initial_misconception,
        module,
      });
      const systemPrompt = substitute(config.deepDivePrompt, {
        ...vars,
        topic: topic.topic,
        module,
        keywords: topic.keywords.join('、'),
        topic_input: topicInput,
      });
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `请针对 topic "${topic.topic}" 做深挖 web search，返回 JSON。`,
        },
      ];
      const result = await callOpenRouter<unknown>({
        model: config.researcherModel,
        messages,
        apiKey: config.openRouterApiKey,
        timeoutMs: config.deepDiveTimeoutMs,
        jsonMode: true,
        errorContext: {
          engine: config.engineLabel,
          stage: 'deep-dive',
          topicIndex: idx + 1,
        },
      });
      if (!result.ok) {
        errors.push(result.error);
        return normalizeDeepDive(null, topic.topic, module);
      }
      return normalizeDeepDive(result.data, topic.topic, module);
    })
  );
  return Promise.all(promises);
}

// ==========================================================
// Stage 3 — Education Mapper
// ==========================================================

async function callEducationMapper(
  config: EngineLoopConfig,
  vars: StageCommonVars,
  hotRadar: HotRadarOutput,
  deepDives: DeepDiveOutput[]
): Promise<
  | { ok: true; data: EducationOpportunity[] }
  | { ok: false; error: EngineError }
> {
  const systemPrompt = substitute(EDUCATION_MAPPER_PROMPT, {
    ...vars,
    stage1_input: JSON.stringify(hotRadar),
    stage2_input: JSON.stringify(deepDives),
  });
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '请基于输入数据反推 education opportunities，返回 JSON。' },
  ];
  const raw = await callOpenRouter<{
    education_opportunities?: unknown[];
  }>({
    model: config.model,
    messages,
    apiKey: config.openRouterApiKey,
    timeoutMs: config.educationMapperTimeoutMs,
    jsonMode: true,
    errorContext: { engine: config.engineLabel, stage: 'education-mapper' },
  });
  if (!raw.ok) return raw;

  const list = Array.isArray(raw.data?.education_opportunities)
    ? raw.data.education_opportunities
    : [];
  const normalized = list
    .map(normalizeEducationOpportunity)
    .filter((e): e is EducationOpportunity => e !== null)
    .slice(0, 3);
  return { ok: true, data: normalized };
}

// ==========================================================
// Stage 4 — Assembler
// ==========================================================

async function callAssembler(
  config: EngineLoopConfig,
  vars: StageCommonVars,
  hotRadar: HotRadarOutput,
  deepDives: DeepDiveOutput[],
  educationOps: EducationOpportunity[]
): Promise<
  | { ok: true; data: EngineAssembledContent }
  | { ok: false; error: EngineError }
> {
  const systemPrompt = substitute(ASSEMBLER_PROMPT, {
    ...vars,
    stage1_input: JSON.stringify(hotRadar),
    stage2_input: JSON.stringify(deepDives),
    stage3_input: JSON.stringify(educationOps),
  });
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '请组装本引擎的 ReportContent，返回 JSON。' },
  ];
  const raw = await callOpenRouter<unknown>({
    model: config.model,
    messages,
    apiKey: config.openRouterApiKey,
    timeoutMs: config.assemblerTimeoutMs,
    jsonMode: true,
    errorContext: { engine: config.engineLabel, stage: 'assembler' },
  });
  if (!raw.ok) return raw;

  // Light validation — the outer synthesizer does its own strict check.
  if (!raw.data || typeof raw.data !== 'object') {
    return {
      ok: false,
      error: {
        engine: config.engineLabel,
        stage: 'assembler',
        errorClass: 'MalformedResponse',
        message: 'Assembler output is not an object',
      },
    };
  }
  const obj = raw.data as Record<string, unknown>;
  if (
    typeof obj.title !== 'string' ||
    typeof obj.dateRange !== 'string' ||
    !Array.isArray(obj.modules)
  ) {
    return {
      ok: false,
      error: {
        engine: config.engineLabel,
        stage: 'assembler',
        errorClass: 'MalformedResponse',
        message: 'Assembler output missing required title/dateRange/modules',
      },
    };
  }
  return { ok: true, data: raw.data as EngineAssembledContent };
}

// ==========================================================
// Output normalizers (defensive — LLMs misbehave on schema)
// ==========================================================

function normalizeHotRadar(
  raw: unknown
): { ok: true; data: HotRadarOutput } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'hot radar output is not an object' };
  }
  const rec = raw as Record<string, unknown>;
  return {
    ok: true,
    data: {
      account_health_topics: normalizeHotRadarTopics(rec.account_health_topics),
      listing_topics: normalizeHotRadarTopics(rec.listing_topics),
      tool_feedback_items: normalizeToolFeedbackItems(rec.tool_feedback_items),
    },
  };
}

function normalizeHotRadarTopics(raw: unknown): HotRadarTopic[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 5)
    .map((item, i) => normalizeHotRadarTopic(item, i + 1))
    .filter((t): t is HotRadarTopic => t !== null);
}

function normalizeHotRadarTopic(
  raw: unknown,
  defaultRank: number
): HotRadarTopic | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const topic = typeof r.topic === 'string' ? r.topic.trim() : '';
  if (!topic) return null;
  const keywords = Array.isArray(r.keywords)
    ? r.keywords.filter((k): k is string => typeof k === 'string').slice(0, 5)
    : [];
  const severity: 'high' | 'medium' | 'low' =
    r.severity === 'high' || r.severity === 'low' ? r.severity : 'medium';

  const channelCountsRaw =
    r.channel_counts && typeof r.channel_counts === 'object'
      ? (r.channel_counts as Record<string, unknown>)
      : {};
  const channelCounts: HotRadarTopic['channel_counts'] = {};
  const weights = { forum: 1.0, provider: 2.0, media: 4.0, kol: 5.0 } as const;
  let computed = 0;
  for (const ch of ['forum', 'provider', 'media', 'kol'] as const) {
    const v = channelCountsRaw[ch];
    const n = typeof v === 'number' && v >= 0 ? v : 0;
    if (n > 0) {
      channelCounts[ch] = n;
      computed += n * weights[ch];
    }
  }
  const llmVolume = typeof r.voice_volume === 'number' ? r.voice_volume : computed;
  const voiceVolume = Number(
    (computed > 0 ? computed : llmVolume).toFixed(1)
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
    channels_observed: Array.isArray(r.channels_observed)
      ? r.channels_observed.filter((c): c is string => typeof c === 'string')
      : [],
    initial_misconception:
      typeof r.initial_misconception === 'string' && r.initial_misconception.trim()
        ? r.initial_misconception
        : null,
    initial_evidence: Array.isArray(r.initial_evidence)
      ? r.initial_evidence
          .filter((e): e is string => typeof e === 'string')
          .slice(0, 4)
      : [],
  };
}

function normalizeToolFeedbackItems(raw: unknown): ToolFeedbackItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeToolFeedbackItem)
    .filter((i): i is ToolFeedbackItem => i !== null);
}

function normalizeToolFeedbackItem(raw: unknown): ToolFeedbackItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const toolName = typeof r.tool_name === 'string' ? r.tool_name.trim() : '';
  if (!toolName) return null;
  const sentiment =
    r.sentiment === 'positive' ||
    r.sentiment === 'negative' ||
    r.sentiment === 'mixed'
      ? r.sentiment
      : 'neutral';

  const channelCountsRaw =
    r.channel_counts && typeof r.channel_counts === 'object'
      ? (r.channel_counts as Record<string, unknown>)
      : {};
  const channelCounts: ToolFeedbackItem['channel_counts'] = {};
  const weights = { forum: 1.0, provider: 2.0, media: 4.0, kol: 5.0 } as const;
  let computed = 0;
  for (const ch of ['forum', 'provider', 'media', 'kol'] as const) {
    const v = channelCountsRaw[ch];
    const n = typeof v === 'number' && v >= 0 ? v : 0;
    if (n > 0) {
      channelCounts[ch] = n;
      computed += n * weights[ch];
    }
  }
  const llmVolume = typeof r.voice_volume === 'number' ? r.voice_volume : computed;
  const voiceVolume = Number(
    (computed > 0 ? computed : llmVolume).toFixed(1)
  );

  return {
    tool_name: toolName,
    sentiment,
    voice_volume: voiceVolume,
    key_feedback_points: Array.isArray(r.key_feedback_points)
      ? r.key_feedback_points
          .filter((p): p is string => typeof p === 'string')
          .slice(0, 5)
      : [],
    evidence_snippets: Array.isArray(r.evidence_snippets)
      ? r.evidence_snippets
          .filter((e): e is string => typeof e === 'string')
          .slice(0, 3)
      : [],
    channel_counts: channelCounts,
    channels_observed: Array.isArray(r.channels_observed)
      ? r.channels_observed.filter((c): c is string => typeof c === 'string')
      : [],
  };
}

function normalizeDeepDive(
  raw: unknown,
  expectedTopic: string,
  expectedModule: HotRadarModuleKey
): DeepDiveOutput {
  const empty: DeepDiveOutput = {
    module: expectedModule,
    topic: expectedTopic,
    confidence: 'Low Confidence · 推测',
    sources_channels: [],
    narrative: '',
    painpoints: '',
    misconception: {
      misconception: '',
      policy_reality: '',
      root_cause_of_misunderstanding: '',
    },
    quotes: [],
    cases: [],
    quantified_observations: [],
  };
  if (!raw || typeof raw !== 'object') return empty;
  const r = raw as Record<string, unknown>;
  const mis = r.misconception;
  const misObj =
    mis && typeof mis === 'object' ? (mis as Record<string, unknown>) : {};

  return {
    module:
      r.module === 'account_health' || r.module === 'listing'
        ? r.module
        : expectedModule,
    topic:
      typeof r.topic === 'string' && r.topic.trim() ? r.topic : expectedTopic,
    confidence:
      typeof r.confidence === 'string' && r.confidence.trim()
        ? r.confidence
        : 'Low Confidence · 推测',
    sources_channels: Array.isArray(r.sources_channels)
      ? r.sources_channels.filter((s): s is string => typeof s === 'string')
      : [],
    narrative: typeof r.narrative === 'string' ? r.narrative : '',
    painpoints: typeof r.painpoints === 'string' ? r.painpoints : '',
    misconception: {
      misconception:
        typeof misObj.misconception === 'string' ? misObj.misconception : '',
      policy_reality:
        typeof misObj.policy_reality === 'string' ? misObj.policy_reality : '',
      root_cause_of_misunderstanding:
        typeof misObj.root_cause_of_misunderstanding === 'string'
          ? misObj.root_cause_of_misunderstanding
          : '',
    },
    quotes: Array.isArray(r.quotes)
      ? r.quotes
          .filter(
            (q): q is { text: string; source: string } =>
              !!q &&
              typeof (q as { text?: unknown }).text === 'string' &&
              typeof (q as { source?: unknown }).source === 'string'
          )
          .slice(0, 3)
      : [],
    cases: Array.isArray(r.cases)
      ? (r.cases as unknown[])
          .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
          .map((c) => ({
            meta: typeof c.meta === 'string' ? c.meta : '',
            title: typeof c.title === 'string' ? c.title : '',
            content: typeof c.content === 'string' ? c.content : '',
          }))
          .filter((c) => c.content.length > 0)
          .slice(0, 3)
      : [],
    quantified_observations: Array.isArray(r.quantified_observations)
      ? r.quantified_observations.filter(
          (o): o is string => typeof o === 'string'
        )
      : [],
  };
}

function normalizeEducationOpportunity(raw: unknown): EducationOpportunity | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const theme = typeof r.theme === 'string' ? r.theme.trim() : '';
  if (!theme) return null;
  const anchorRaw =
    r.education_anchor && typeof r.education_anchor === 'object'
      ? (r.education_anchor as Record<string, unknown>)
      : {};
  return {
    rank: typeof r.rank === 'number' ? r.rank : 1,
    theme,
    target_audience:
      typeof r.target_audience === 'string' ? r.target_audience : '',
    linked_topics: Array.isArray(r.linked_topics)
      ? r.linked_topics.filter((t): t is string => typeof t === 'string')
      : [],
    misconception_summary:
      typeof r.misconception_summary === 'string' ? r.misconception_summary : '',
    education_anchor: {
      wrong_belief:
        typeof anchorRaw.wrong_belief === 'string' ? anchorRaw.wrong_belief : '',
      correct_practice:
        typeof anchorRaw.correct_practice === 'string'
          ? anchorRaw.correct_practice
          : '',
    },
    recommended_format: Array.isArray(r.recommended_format)
      ? r.recommended_format
          .filter((f): f is string => typeof f === 'string')
          .slice(0, 4)
      : [],
    supporting_evidence: Array.isArray(r.supporting_evidence)
      ? r.supporting_evidence
          .filter((e): e is string => typeof e === 'string')
          .slice(0, 4)
      : [],
    urgency:
      r.urgency === 'high' || r.urgency === 'low' ? r.urgency : 'medium',
  };
}
