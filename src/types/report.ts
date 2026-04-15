export interface ReportContent {
  title: string;
  dateRange: string;
  modules: ReportModule[];
}

export interface ReportModule {
  title: string;
  subtitle?: string;
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
