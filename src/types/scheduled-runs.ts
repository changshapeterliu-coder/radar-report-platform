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
  | 'hot-radar-scan'
  | 'deep-dive'
  | 'education-mapper'
  | 'assembler';

export interface EngineError {
  engine: 'gemini' | 'kimi' | 'synthesizer';
  stage?: LoopStage;
  topicIndex?: number;
  errorClass: EngineErrorClass;
  message: string;
  httpStatus?: number;
}

// ============================================================
// v3 Hot-Radar-Driven types
// ============================================================

/**
 * Channel type classification emitted by researchers and used to compute
 * Voice Volume. Weights (per PPT Slide 1):
 *   - forum    → 1.0
 *   - provider → 2.0
 *   - media    → 4.0
 *   - kol      → 5.0
 */
export type ChannelType = 'forum' | 'provider' | 'media' | 'kol';

export const CHANNEL_WEIGHT: Record<ChannelType, number> = {
  forum: 1.0,
  provider: 2.0,
  media: 4.0,
  kol: 5.0,
};

/**
 * v3 HotRadar module buckets. "account_health" covers suspension /
 * warnings / account compliance audits. "listing" covers listing
 * takedowns / IP / content compliance.
 */
export const HOT_RADAR_MODULE_KEYS = ['account_health', 'listing'] as const;
export type HotRadarModuleKey = (typeof HOT_RADAR_MODULE_KEYS)[number];

/**
 * Each Top-N topic found by the hot-radar scanner (Stage 1).
 */
export interface HotRadarTopic {
  rank: number;
  topic: string;
  voice_volume: number;
  keywords: string[];
  seller_discussion: string;
  severity: 'high' | 'medium' | 'low';
  channel_counts: Partial<Record<ChannelType, number>>;
  channels_observed: string[];
  initial_misconception: string | null;
  initial_evidence: string[];
}

/**
 * Tool feedback item (not ranked as Top N — listed per tool).
 */
export interface ToolFeedbackItem {
  tool_name: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  voice_volume: number;
  key_feedback_points: string[];
  evidence_snippets: string[];
  channel_counts: Partial<Record<ChannelType, number>>;
  channels_observed: string[];
}

/**
 * Stage 1 output for a single engine.
 */
export interface HotRadarOutput {
  account_health_topics: HotRadarTopic[];
  listing_topics: HotRadarTopic[];
  tool_feedback_items: ToolFeedbackItem[];
}

/**
 * Stage 2 output — deep-dive for one topic.
 */
export interface DeepDiveOutput {
  module: HotRadarModuleKey;
  topic: string;
  confidence: string;
  sources_channels: string[];
  narrative: string;
  painpoints: string;
  misconception: {
    misconception: string;
    policy_reality: string;
    root_cause_of_misunderstanding: string;
  };
  quotes: Array<{ text: string; source: string }>;
  cases: Array<{ meta: string; title: string; content: string }>;
  quantified_observations: string[];
}

/**
 * Stage 3 — one education opportunity reverse-inferred from Stage 1+2.
 */
export interface EducationOpportunity {
  rank: number;
  theme: string;
  target_audience: string;
  linked_topics: string[];
  misconception_summary: string;
  education_anchor: {
    wrong_belief: string;
    correct_practice: string;
  };
  recommended_format: string[];
  supporting_evidence: string[];
  urgency: 'high' | 'medium' | 'low';
}

/**
 * Stage 4 output — per-engine assembled ReportContent (sent to synthesizer).
 * Structurally identical to final ReportContent: 4 modules in fixed order
 * (suspension → listing → tool_feedback → education), each with tables + blocks.
 */
export type EngineAssembledContent = ReportContent;

/** One research engine's full trace — what "View Logs" renders. */
export interface EngineLoopTrace {
  hotRadar: HotRadarOutput | null;
  deepDives: DeepDiveOutput[];
  educationOpportunities: EducationOpportunity[];
  assembled: EngineAssembledContent | null;
}

export interface ResearchEngineInput {
  coverageWindow: CoverageWindow;
  domainName: string;
  /** Engine A Stage 1 prompt (DeepSeek persona). */
  engineAHotRadarPrompt: string;
  /** Engine B Stage 1 prompt (Kimi persona). */
  engineBHotRadarPrompt: string;
  /** Shared Stage 2 deep-dive prompt (both engines). */
  sharedDeepDivePrompt: string;
  /** Outer synthesizer merge prompt. */
  synthesizerPrompt: string;
  openRouterApiKey: string;
  /** Loop-wide soft cap; individual stage timeouts override. */
  engineTimeoutMs?: number;
  /** Synthesizer call timeout. Default 3 * 60_000. */
  synthTimeoutMs?: number;
  /** How many top topics per module to deep-dive in Stage 2. Default 3. */
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

export type PromptKey =
  | 'engine_a_hot_radar'
  | 'engine_b_hot_radar'
  | 'shared_deep_dive'
  | 'synthesizer_prompt';

export interface PromptTemplateInput {
  prompt_type: PromptKey;
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
