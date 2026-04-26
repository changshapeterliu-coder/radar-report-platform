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
  | 'engine-summarizer';

export interface EngineError {
  engine: 'gemini' | 'kimi' | 'synthesizer';
  stage?: LoopStage;
  subquestionIndex?: number;
  errorClass: EngineErrorClass;
  message: string;
  httpStatus?: number;
}

/** One research engine's full 5-stage trace — what "View Logs" renders. */
export interface EngineLoopTrace {
  plan: unknown | null;
  researchRound1: Array<{ subquestion: string; findings: unknown }>;
  gapAnalysis: unknown | null;
  researchRound2: Array<{ subquestion: string; findings: unknown }>;
  summary: unknown | null;
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
  maxSubquestionsPerRound?: number;
  /** Gap-analyzer output ceiling. Default 4. */
  maxGapSubquestions?: number;
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
