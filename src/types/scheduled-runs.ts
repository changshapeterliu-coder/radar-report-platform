import type { ReportContent } from './report';

// ============================================================
// Coverage window / week label
// ============================================================

export interface CoverageWindow {
  /** ISO-8601 UTC timestamp of the window start (exclusive of earlier data). */
  startIso: string;
  /** ISO-8601 UTC timestamp of the window end (inclusive). */
  endIso: string;
  /** "MMDD to MMDD" label derived from Asia/Shanghai wall-clock dates of start/end. */
  weekLabel: string;
}

// ============================================================
// Research engine types (mirrored in src/lib/research-engine/types.ts;
// that module re-exports from here so the research-engine folder
// remains dependency-isolated from any business code).
// ============================================================

export type EngineErrorClass =
  | 'TimeoutError'
  | 'CreditsExhausted'
  | 'RateLimited'
  | 'ServerError'
  | 'MalformedResponse'
  | 'NetworkError';

export type LoopStage =
  | 'planner'
  | 'researcher'
  | 'gap-analyzer'
  | 'deeper-researcher'
  | 'top5-ranker'
  | 'deep-researcher'
  | 'engine-summarizer';

export interface EngineError {
  engine: 'gemini' | 'kimi' | 'synthesizer';
  stage?: LoopStage;
  subquestionIndex?: number;
  errorClass: EngineErrorClass;
  message: string;
  httpStatus?: number;
}

// ============================================================
// Top 5 ranking + deep-dive types
// ============================================================

/**
 * Channel type classification emitted by researchers and used by the
 * Top5 Ranker to compute Voice Volume. Weights (per PPT Slide 1):
 *   - forum    → 1.0
 *   - provider → 2.0
 *   - media    → 4.0
 *   - kol      → 5.0
 * Classification rubric lives in the shared researcher prompt; the ranker
 * trusts whatever label researchers emit.
 */
export type ChannelType = 'forum' | 'provider' | 'media' | 'kol';

export const CHANNEL_WEIGHT: Record<ChannelType, number> = {
  forum: 1.0,
  provider: 2.0,
  media: 4.0,
  kol: 5.0,
};

export const MODULE_KEYS = [
  'suspension',
  'listing',
  'tool_feedback',
  'education',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface Top5Entry {
  rank: number; // 1..5
  topic: string;
  voice_volume: number;
  keywords: string[]; // 3-5 items
  seller_discussion: string; // 1-2 sentences (<=30 Chinese chars recommended)
  severity: 'high' | 'medium' | 'low';
  /** Channel breakdown — used for Volume audit, not displayed in the final report. */
  channel_counts: Partial<Record<ChannelType, number>>;
}

export interface Top5RankerOutput {
  modules: Record<ModuleKey, Top5Entry[]>;
}

export interface DeepDiveOutput {
  topic: string;
  module: ModuleKey;
  /** Full background / context paragraph. */
  narrative: string;
  /** Distilled pain points (3-5 short items). */
  painpoints: string[];
  /** Verbatim seller quotes with attribution (channel · author · date). */
  quotes: Array<{ quote: string; source: string }>;
  /** Concrete seller cases: what they tried, what happened, what they want. */
  cases: Array<{ title?: string; content: string; meta?: string }>;
  /** Optional actionable recommendation. */
  recommendation?: string;
}

/** One research engine's full trace — what "View Logs" renders. */
export interface EngineLoopTrace {
  plan: unknown | null;
  /** Stage 2 broad-scan findings (each finding includes source_channel_type). */
  researchRound1: Array<{ subquestion: string; findings: unknown }>;
  /** Stage 3: Top 5 Ranker output per module. Null if ranking failed. */
  top5Ranking: Top5RankerOutput | null;
  /** Stage 4: deep-dive output, one entry per (module, top-3 topic). */
  deepDives: DeepDiveOutput[];
  /** Stage 5: engine summarizer consolidation. */
  summary: unknown | null;
  /** Legacy gap-analyzer + round-2 fields. Retained so existing JSONB data still parses
   *  but no longer populated by the new loop. */
  gapAnalysis?: unknown | null;
  researchRound2?: Array<{ subquestion: string; findings: unknown }>;
}

export interface ResearchEngineInput {
  coverageWindow: CoverageWindow;
  domainName: string;
  geminiPrompt: string;
  kimiPrompt: string;
  synthesizerPrompt: string;
  openRouterApiKey: string;
  /** Loop-wide soft cap; individual stage timeouts override. Default 5 * 60_000. */
  engineTimeoutMs?: number;
  /** Synthesizer call timeout. Default 3 * 60_000. */
  synthTimeoutMs?: number;
  /** Planner output ceiling. Default 8. */
  /** Planner output ceiling. Default 12 (v3 loop expects broader subquestion set). */
  maxSubquestionsPerRound?: number;
  /** How many top topics per module to deep-dive in Stage 4. Default 3. */
  deepDivePerModule?: number;
}

export interface ResearchEngineOutput {
  content: ReportContent | null;
  engineOutputs: {
    gemini: EngineLoopTrace | null;
    kimi: EngineLoopTrace | null;
    synthesizer: unknown | null;
  };
  errors: EngineError[];
}

// ============================================================
// API request / response shapes
// ============================================================

export interface ScheduleConfigInput {
  enabled: boolean;
  cadence: 'weekly' | 'biweekly';
  day_of_week: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
  time_of_day: string;
}

export interface PromptTemplateInput {
  prompt_type: 'gemini_prompt' | 'kimi_prompt' | 'synthesizer_prompt';
  template_text: string;
}

// ============================================================
// Inngest event payload
// ============================================================

export interface InngestGenerateReportEvent {
  domainId: string;
  triggerType: 'scheduled' | 'manual';
  coverageWindowStart: string;
  coverageWindowEnd: string;
  weekLabel: string;
}
