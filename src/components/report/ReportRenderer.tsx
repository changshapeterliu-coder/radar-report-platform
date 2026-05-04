'use client';

import { Badge } from '@/components/ui/badge';
import type {
  ReportModule,
  ReportTable,
  AnalysisSection,
  Quote,
  KeyPoint,
  HighlightBox,
  TableCell,
} from '@/types/report';
import BlockRenderer from './BlockRenderer';
import MarkdownRenderer from './MarkdownRenderer';
import TopTopicsTable from './TopTopicsTable';
import { isMarkdownModule } from '@/lib/validators/report-schema';

/**
 * ReportRenderer — dispatches a ReportModule to the right inner renderer
 * (v4 Markdown-hybrid vs legacy v1-v3 blocks) and delegates content rendering.
 *
 * Design refs:
 * - ui-design-system.md sec 1 (tokens), sec 3.3 (card conventions),
 *   sec 4.3 (Badge variants)
 * - power design-guidelines.md sec 5.1 Content Primacy, sec 6.1 Readability
 */

// ─── Badge variant mapping ───

/**
 * Map a severity-ish level to the Badge primitive variant. Used by cell
 * badges inside AI-produced tables.
 */
function badgeVariantFor(
  level: 'high' | 'medium' | 'low'
): 'danger' | 'warning' | 'info' {
  switch (level) {
    case 'high':
      return 'danger';
    case 'medium':
      return 'warning';
    case 'low':
      return 'info';
  }
}

/**
 * Heuristic mapping for free-form cell badge labels (from pre-v4 reports).
 * Keeps parity with the old `riskColor` helper.
 */
function riskVariant(label: string): 'danger' | 'warning' | 'info' {
  const l = label.toLowerCase();
  if (l.includes('high') || l.includes('severity') || l.includes('chain')) {
    return 'danger';
  }
  if (l.includes('medium') || l.includes('recovery')) return 'warning';
  return 'info';
}

// ─── Cell ───

function CellContent({ cell }: { cell: TableCell }) {
  return (
    <>
      <span className="text-sm">{cell.text}</span>
      {cell.badge && (
        <span className="ml-2">
          <Badge variant={badgeVariantFor(cell.badge.level)}>
            {cell.badge.text}
          </Badge>
        </span>
      )}
    </>
  );
}

// ─── Row normalization (accept array-of-arrays OR { cells: [...] }) ───

function normalizeCell(raw: unknown): TableCell {
  try {
    if (raw == null) return { text: '' };
    if (typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (typeof obj.text === 'string') {
        const badgeRaw = obj.badge;
        if (
          badgeRaw &&
          typeof badgeRaw === 'object' &&
          typeof (badgeRaw as Record<string, unknown>).text === 'string'
        ) {
          const b = badgeRaw as Record<string, unknown>;
          const level =
            b.level === 'high' || b.level === 'medium' || b.level === 'low'
              ? (b.level as 'high' | 'medium' | 'low')
              : 'low';
          return {
            text: obj.text,
            badge: { text: String(b.text), level },
          };
        }
        return { text: obj.text };
      }
      try {
        return { text: JSON.stringify(raw) };
      } catch {
        return { text: '' };
      }
    }
    return { text: String(raw) };
  } catch {
    return { text: '' };
  }
}

function normalizeRow(raw: unknown): { cells: TableCell[] } {
  try {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const obj = raw as Record<string, unknown>;
      if (Array.isArray(obj.cells)) {
        return { cells: obj.cells.map(normalizeCell) };
      }
      const vals = Object.values(obj);
      return { cells: vals.map(normalizeCell) };
    }
    if (Array.isArray(raw)) {
      return { cells: raw.map(normalizeCell) };
    }
    return { cells: [] };
  } catch {
    return { cells: [] };
  }
}

// ─── Table ───

function TableRenderer({ table }: { table: ReportTable }) {
  const headers = Array.isArray(table.headers) ? table.headers : [];
  const normalizedRows = (Array.isArray(table.rows) ? table.rows : []).map(
    normalizeRow
  );

  if (headers.length === 0 && normalizedRows.length === 0) return null;

  return (
    <div className="my-5 overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/40">
              {headers.map((header, i) => (
                <th
                  key={i}
                  scope="col"
                  className="border-b border-border px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {normalizedRows.map((row, ri) => (
              <tr key={ri} className="hover:bg-muted/40">
                {row.cells.map((cell, ci) => (
                  <td
                    key={ci}
                    className="border-b border-border px-4 py-3 text-foreground"
                  >
                    <CellContent cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Quote (legacy) ───

function QuoteRenderer({ quote }: { quote: Quote }) {
  return (
    <blockquote className="my-4 border-l-2 border-border-strong py-1 pl-4">
      <p className="text-[15px] italic leading-relaxed text-foreground-muted">
        {quote.text}
      </p>
      <span className="mt-2 block text-xs text-foreground-subtle">
        — {quote.source}
      </span>
    </blockquote>
  );
}

// ─── KeyPoint (legacy) ───

function KeyPointRenderer({ point }: { point: KeyPoint }) {
  return (
    <li className="mb-3">
      <span className="font-semibold text-foreground">{point.label}</span>
      <span className="mx-1.5 text-foreground-subtle">·</span>
      <span className="text-foreground">{point.content}</span>
      {point.impactTags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {point.impactTags.map((tag, i) => (
            <Badge key={i} variant="info">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </li>
  );
}

// ─── AnalysisSection (legacy) ───

function AnalysisSectionRenderer({ section }: { section: AnalysisSection }) {
  return (
    <div className="my-6 border-b border-border pb-5 last:border-b-0">
      <h3 className="mb-4 text-lg font-semibold text-foreground">
        {section.title}
      </h3>

      {section.quotes.map((q, i) => (
        <QuoteRenderer key={i} quote={q} />
      ))}

      {section.keyPoints.length > 0 && (
        <ul className="mt-3 list-none pl-0">
          {section.keyPoints.map((kp, i) => (
            <KeyPointRenderer key={i} point={kp} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── HighlightBox (legacy) ───

function HighlightBoxRenderer({ box }: { box: HighlightBox }) {
  return (
    <div className="my-4 rounded-md border-l-2 border-info bg-info-bg py-2 pl-4">
      <p className="mb-1 text-xs font-medium text-info-fg">{box.title}</p>
      <p className="text-[15px] leading-relaxed text-foreground">{box.content}</p>
    </div>
  );
}

// ─── Module Card ───

function ModuleCard({ module }: { module: ReportModule }) {
  if (isMarkdownModule(module)) {
    return <MarkdownModuleCard module={module} />;
  }
  return <LegacyModuleCard module={module} />;
}

function MarkdownModuleCard({ module }: { module: ReportModule }) {
  const hasTopTopics =
    Array.isArray(module.topTopics) && module.topTopics.length > 0;
  return (
    <div className="mb-8 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border px-6 py-5 sm:px-10">
        <h2 className="text-xl font-semibold text-foreground">{module.title}</h2>
        {module.subtitle && (
          <p className="mt-1 text-sm text-foreground-muted">{module.subtitle}</p>
        )}
      </div>
      <div className="px-6 py-8 sm:px-10">
        <div className="mx-auto max-w-[820px]">
          {hasTopTopics && <TopTopicsTable topics={module.topTopics!} />}
          <MarkdownRenderer source={module.markdown ?? ''} />
        </div>
      </div>
    </div>
  );
}

function LegacyModuleCard({ module }: { module: ReportModule }) {
  const hasBlocks = Array.isArray(module.blocks) && module.blocks.length > 0;
  const hasLegacyParagraphs =
    Array.isArray(module.paragraphs) && module.paragraphs.length > 0;

  return (
    <div className="mb-8 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border px-6 py-5 sm:px-10">
        <h2 className="text-xl font-semibold text-foreground">{module.title}</h2>
        {module.subtitle && (
          <p className="mt-1 text-sm text-foreground-muted">{module.subtitle}</p>
        )}
      </div>

      <div className="px-6 py-8 sm:px-10">
        <div className="mx-auto max-w-[680px] space-y-5">
          {/* Tables first — overview at top */}
          {(module.tables ?? []).map((t, i) => (
            <TableRenderer key={i} table={t} />
          ))}

          {hasBlocks &&
            module.blocks!.map((block, i) => (
              <BlockRenderer key={i} block={block} />
            ))}

          {!hasBlocks &&
            hasLegacyParagraphs &&
            module.paragraphs!.map((p, i) => (
              <p
                key={i}
                className="text-[15px] leading-[1.85] text-foreground"
              >
                {p}
              </p>
            ))}

          {(module.analysisSections ?? []).map((s, i) => (
            <AnalysisSectionRenderer key={i} section={s} />
          ))}

          {(module.highlightBoxes ?? []).map((h, i) => (
            <HighlightBoxRenderer key={i} box={h} />
          ))}

          {!hasBlocks &&
            !hasLegacyParagraphs &&
            (module.tables ?? []).length === 0 &&
            (module.analysisSections ?? []).length === 0 &&
            (module.highlightBoxes ?? []).length === 0 && (
              <p className="py-8 text-center text-sm italic text-foreground-subtle">
                本周该模块暂无显著发现 / No notable findings this period
              </p>
            )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Export ───

export interface ReportRendererProps {
  module: ReportModule;
}

export default function ReportRenderer({ module }: ReportRendererProps) {
  return <ModuleCard module={module} />;
}

export {
  badgeVariantFor,
  riskVariant,
  CellContent,
  TableRenderer,
  QuoteRenderer,
  KeyPointRenderer,
  AnalysisSectionRenderer,
  HighlightBoxRenderer,
  ModuleCard,
};
