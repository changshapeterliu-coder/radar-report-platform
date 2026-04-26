export interface ReportContent {
  title: string;
  dateRange: string;
  modules: ReportModule[];
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
  blocks?: ContentBlock[];
  /** @deprecated use blocks instead — kept for backward compatibility */
  paragraphs?: string[];
  tables: ReportTable[];
  analysisSections: AnalysisSection[];
  highlightBoxes: HighlightBox[];
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
