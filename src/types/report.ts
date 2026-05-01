export interface ReportContent {
  title: string;
  dateRange: string;
  modules: ReportModule[];
}

// ============================================================
// v4 Markdown-hybrid schema — the new primary content path.
// Modules that have `markdown` set are rendered through
// MarkdownRenderer; modules missing `markdown` fall back to
// the legacy blocks/tables path for backward compatibility.
// ============================================================

/**
 * A single Top-N topic in a module. Structured so Dashboard trending,
 * topic_rankings extraction, and cross-week comparisons can consume it
 * without re-parsing Markdown prose.
 */
export interface TopTopic {
  /** Human rank label, e.g. "1 ✓" (cross-engine confirmed) or "1" (single-engine). */
  rank: string;
  topic: string;
  voice_volume: number;
  keywords: string[];
  seller_discussion: string;
  severity: 'high' | 'medium' | 'low';
  /** Optional — true when both engines independently surfaced this topic. */
  cross_engine_confirmed?: boolean;
}

/**
 * A single tool feedback entry for the "Account Health Tool Feedback" module.
 */
export interface TopTool {
  tool_name: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  voice_volume: number;
  key_feedback_points: string[];
}

/**
 * A single education opportunity for the "Education Opportunities" module.
 */
export interface TopEducationOpp {
  rank: string;
  theme: string;
  target_audience: string;
  urgency: 'high' | 'medium' | 'low';
  recommended_format: string[];
}

export type BlockType =
  | 'heading'
  | 'narrative'
  | 'insight'
  | 'quote'
  | 'stat'
  | 'warning'
  | 'recommendation'
  | 'list';

export interface ContentBlock {
  type: BlockType;
  /** Main text content (for heading/narrative/insight/warning/recommendation) */
  text?: string;
  /** For quotes: verbatim speaker text */
  quote?: string;
  /** For quotes: attribution source (e.g., "小红书 @xxx · 2026-01-15") */
  source?: string;
  /** For stats: array of data points */
  stats?: Array<{ value: string; label: string }>;
  /** For list: ordered items */
  items?: Array<{ title?: string; content: string; meta?: string }>;
  /** Optional small label above content (e.g., "Key Insight", "Policy Conflict") */
  label?: string;
}

export interface ReportModule {
  title: string;
  subtitle?: string;

  // ─── v4 Markdown-hybrid fields (preferred) ───
  /**
   * Human-readable report body rendered via react-markdown + remark-gfm.
   * Supports GitHub-style tables, blockquotes, and custom callouts via
   * the `> [!INSIGHT]` / `> [!WARNING]` / `> [!RECOMMENDATION]` / `> [!STAT]`
   * directives. When present, this is the primary rendering path.
   */
  markdown?: string;
  /**
   * Structured Top-N topics for this module. Consumed by Dashboard,
   * topic_rankings extraction, cross-week comparisons. Fixed schema.
   */
  topTopics?: TopTopic[];
  /**
   * Structured tool feedback entries — used only for the
   * "Account Health Tool Feedback" module.
   */
  topTools?: TopTool[];
  /**
   * Structured education opportunities — used only for the
   * "Education Opportunities" module.
   */
  topEducationOpps?: TopEducationOpp[];

  // ─── Legacy fields (v1-v3, kept for backward compatibility) ───
  blocks?: ContentBlock[];
  /** @deprecated use blocks / markdown instead */
  paragraphs?: string[];
  /** @deprecated legacy v1-v3 — TableRenderer path. Prefer markdown + topTopics. */
  tables?: ReportTable[];
  /** @deprecated legacy v1-v3 */
  analysisSections?: AnalysisSection[];
  /** @deprecated legacy v1-v3 */
  highlightBoxes?: HighlightBox[];
}

export interface ReportTable {
  headers: string[];
  rows: TableRow[];
}

export interface TableRow {
  cells: TableCell[];
}

export interface TableCell {
  text: string;
  badge?: { text: string; level: 'high' | 'medium' | 'low' };
}

export interface AnalysisSection {
  title: string;
  quotes: Quote[];
  keyPoints: KeyPoint[];
}

export interface Quote {
  text: string;
  source: string;
}

export interface KeyPoint {
  label: string;
  content: string;
  impactTags: string[];
}

export interface HighlightBox {
  title: string;
  content: string;
}
