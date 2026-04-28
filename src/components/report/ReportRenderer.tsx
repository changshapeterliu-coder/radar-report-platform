'use client';

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

/* ─── Badge helpers ─── */

function badgeColor(level: 'high' | 'medium' | 'low') {
  switch (level) {
    case 'high':
      return 'bg-red-50 text-red-700 border border-red-200';
    case 'medium':
      return 'bg-yellow-50 text-yellow-700 border border-yellow-200';
    case 'low':
      return 'bg-blue-50 text-[#146eb4] border border-blue-200';
  }
}

function riskColor(label: string) {
  const l = label.toLowerCase();
  if (l.includes('high') || l.includes('severity') || l.includes('chain'))
    return 'bg-red-50 text-red-700 border border-red-200';
  if (l.includes('medium') || l.includes('recovery'))
    return 'bg-yellow-50 text-yellow-700 border border-yellow-200';
  return 'bg-blue-50 text-[#146eb4] border border-blue-200';
}

/* ─── Cell ─── */

function CellContent({ cell }: { cell: TableCell }) {
  return (
    <>
      <span className="text-sm">{cell.text}</span>
      {cell.badge && (
        <span className={`ml-2 inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${badgeColor(cell.badge.level)}`}>
          {cell.badge.text}
        </span>
      )}
    </>
  );
}

/* ─── Row normalization (accept array-of-arrays OR { cells: [...] }) ─── */

function normalizeCell(raw: unknown): TableCell {
  if (raw == null) return { text: '' };
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.text === 'string') {
      const badge = obj.badge as TableCell['badge'];
      return badge ? { text: obj.text, badge } : { text: obj.text };
    }
    return { text: JSON.stringify(raw) };
  }
  return { text: String(raw) };
}

function normalizeRow(raw: unknown): { cells: TableCell[] } {
  // Already in canonical shape: { cells: [...] }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.cells)) {
      return { cells: obj.cells.map(normalizeCell) };
    }
  }
  // Legacy / AI-produced shape: plain array of values
  if (Array.isArray(raw)) {
    return { cells: raw.map(normalizeCell) };
  }
  return { cells: [] };
}

/* ─── Table ─── */

function TableRenderer({ table }: { table: ReportTable }) {
  const headers = Array.isArray(table.headers) ? table.headers : [];
  const normalizedRows = (Array.isArray(table.rows) ? table.rows : []).map(normalizeRow);

  if (headers.length === 0 && normalizedRows.length === 0) return null;

  return (
    <div className="my-5 rounded-lg overflow-hidden border border-gray-200">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50">
              {headers.map((header, i) => (
                <th
                  key={i}
                  className="text-left px-4 py-3 font-semibold text-[#232f3e] border-b border-gray-200"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {normalizedRows.map((row, ri) => (
              <tr key={ri} className="hover:bg-gray-50/50">
                {row.cells.map((cell, ci) => (
                  <td key={ci} className="px-4 py-3 border-b border-gray-100 text-gray-800">
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

/* ─── Quote (legacy, used in AnalysisSection) ─── */

function QuoteRenderer({ quote }: { quote: Quote }) {
  return (
    <blockquote className="border-l-2 border-gray-300 pl-4 py-1 my-4">
      <p className="text-[15px] leading-relaxed text-gray-700 italic">{quote.text}</p>
      <span className="block mt-2 text-xs text-gray-500">— {quote.source}</span>
    </blockquote>
  );
}

/* ─── KeyPoint (legacy) ─── */

function KeyPointRenderer({ point }: { point: KeyPoint }) {
  return (
    <li className="mb-3">
      <span className="font-semibold text-[#232f3e]">{point.label}</span>
      <span className="text-gray-400 mx-1.5">·</span>
      <span className="text-gray-700">{point.content}</span>
      {point.impactTags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {point.impactTags.map((tag, i) => (
            <span
              key={i}
              className="inline-block rounded-md bg-blue-50 text-[#146eb4] border border-blue-200 px-2 py-0.5 text-[11px] font-medium"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

/* ─── AnalysisSection (legacy) ─── */

function AnalysisSectionRenderer({ section }: { section: AnalysisSection }) {
  return (
    <div className="my-6 pb-5 border-b border-gray-100 last:border-b-0">
      <h3 className="text-lg font-semibold text-[#232f3e] mb-4">{section.title}</h3>

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

/* ─── HighlightBox (legacy) ─── */

function HighlightBoxRenderer({ box }: { box: HighlightBox }) {
  return (
    <div className="border-l-2 border-[#146eb4] pl-4 py-1 my-4">
      <p className="text-xs text-[#146eb4] font-medium mb-1">{box.title}</p>
      <p className="text-[15px] leading-relaxed text-[#232f3e]">{box.content}</p>
    </div>
  );
}

/* ─── Module Card ─── */

function ModuleCard({ module }: { module: ReportModule }) {
  const hasBlocks = Array.isArray(module.blocks) && module.blocks.length > 0;
  const hasLegacyParagraphs = Array.isArray(module.paragraphs) && module.paragraphs.length > 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 mb-8 overflow-hidden">
      {/* Simple header */}
      <div className="px-6 sm:px-10 py-5 border-b border-gray-200">
        <h2 className="text-xl font-bold text-[#232f3e]">{module.title}</h2>
        {module.subtitle && (
          <p className="text-sm text-gray-500 mt-1">{module.subtitle}</p>
        )}
      </div>

      {/* Body — max-width constrained for readability */}
      <div className="px-6 sm:px-10 py-8">
        <div className="max-w-[680px] mx-auto space-y-5">
          {/* New: blocks */}
          {hasBlocks && module.blocks!.map((block, i) => (
            <BlockRenderer key={i} block={block} />
          ))}

          {/* Legacy: paragraphs fallback (for old reports) */}
          {!hasBlocks && hasLegacyParagraphs && module.paragraphs!.map((p, i) => (
            <p key={i} className="text-[15px] leading-[1.85] text-gray-800">{p}</p>
          ))}

          {/* Tables — optional, render only if present */}
          {(module.tables ?? []).map((t, i) => (
            <TableRenderer key={i} table={t} />
          ))}

          {/* Legacy analysis sections — optional */}
          {(module.analysisSections ?? []).map((s, i) => (
            <AnalysisSectionRenderer key={i} section={s} />
          ))}

          {/* Legacy highlight boxes — optional */}
          {(module.highlightBoxes ?? []).map((h, i) => (
            <HighlightBoxRenderer key={i} box={h} />
          ))}

          {/* Empty module friendly message */}
          {!hasBlocks &&
            !hasLegacyParagraphs &&
            (module.tables ?? []).length === 0 &&
            (module.analysisSections ?? []).length === 0 &&
            (module.highlightBoxes ?? []).length === 0 && (
              <p className="text-sm text-gray-400 italic text-center py-8">
                本周该模块暂无显著发现 / No notable findings this period
              </p>
            )}
        </div>
      </div>
    </div>
  );
}

/* ─── Main Export ─── */

export interface ReportRendererProps {
  module: ReportModule;
}

export default function ReportRenderer({ module }: ReportRendererProps) {
  return <ModuleCard module={module} />;
}

export { badgeColor, riskColor, CellContent, TableRenderer, QuoteRenderer, KeyPointRenderer, AnalysisSectionRenderer, HighlightBoxRenderer, ModuleCard };
