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

/* ─── Badge / Risk Pill ─── */

function badgeColor(level: 'high' | 'medium' | 'low') {
  switch (level) {
    case 'high':
      return 'bg-red-100 text-red-700 border border-red-300';
    case 'medium':
      return 'bg-yellow-100 text-yellow-700 border border-yellow-300';
    case 'low':
      return 'bg-blue-100 text-[#146eb4] border border-blue-300';
  }
}

function riskColor(label: string) {
  const l = label.toLowerCase();
  if (l.includes('high') || l.includes('severity') || l.includes('chain'))
    return 'bg-red-100 text-red-700 border border-red-300';
  if (l.includes('medium') || l.includes('recovery'))
    return 'bg-yellow-100 text-yellow-700 border border-yellow-300';
  return 'bg-blue-100 text-[#146eb4] border border-blue-300';
}

/* ─── Cell Renderer ─── */

function CellContent({ cell }: { cell: TableCell }) {
  return (
    <>
      <span>{cell.text}</span>
      {cell.badge && (
        <span
          className={`ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${badgeColor(cell.badge.level)}`}
        >
          {cell.badge.text}
        </span>
      )}
    </>
  );
}

/* ─── Table Renderer ─── */

function TableRenderer({ table }: { table: ReportTable }) {
  return (
    <div className="overflow-x-auto my-4">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {table.headers.map((header, i) => (
              <th
                key={i}
                className="bg-[#f2f3f3] text-left px-4 py-3 font-bold border-b-2 border-[#d5dbdb]"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-blue-50/30">
              {row.cells.map((cell, ci) => (
                <td key={ci} className="px-4 py-3 border-b border-[#d5dbdb]">
                  <CellContent cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Quote Renderer ─── */

function QuoteRenderer({ quote }: { quote: Quote }) {
  return (
    <blockquote className="bg-[#f2f3f3] border-l-4 border-[#146eb4] p-4 my-4 italic">
      <p>{quote.text}</p>
      <span className="block mt-1 text-xs text-gray-500 not-italic">— {quote.source}</span>
    </blockquote>
  );
}

/* ─── KeyPoint Renderer ─── */

function KeyPointRenderer({ point }: { point: KeyPoint }) {
  return (
    <li className="mb-3">
      <span className="font-semibold text-[#232f3e]">{point.label}:</span>{' '}
      <span>{point.content}</span>
      {point.impactTags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {point.impactTags.map((tag, i) => (
            <span
              key={i}
              className="inline-block rounded-full bg-blue-100 text-[#146eb4] border border-blue-300 px-2 py-0.5 text-xs font-bold"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

/* ─── AnalysisSection Renderer ─── */

function AnalysisSectionRenderer({ section }: { section: AnalysisSection }) {
  return (
    <div className="my-6 pb-5 border-b border-[#d5dbdb] last:border-b-0">
      <h3 className="text-lg mb-4 pb-2 border-b-2 border-[#ff9900] inline-block text-[#232f3e] font-semibold">
        {section.title}
      </h3>

      {section.quotes.map((q, i) => (
        <QuoteRenderer key={i} quote={q} />
      ))}

      {section.keyPoints.length > 0 && (
        <ul className="list-disc pl-5 mt-3">
          {section.keyPoints.map((kp, i) => (
            <KeyPointRenderer key={i} point={kp} />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── HighlightBox Renderer ─── */

function HighlightBoxRenderer({ box }: { box: HighlightBox }) {
  return (
    <div className="bg-blue-50 border-l-4 border-[#146eb4] rounded-md p-4 my-4">
      <p className="font-bold text-[#232f3e] mb-1">{box.title}</p>
      <p className="text-sm">{box.content}</p>
    </div>
  );
}

/* ─── Module Card Renderer ─── */

function ModuleCard({ module }: { module: ReportModule }) {
  return (
    <div className="bg-white rounded-lg shadow border border-[#d5dbdb] mb-8 overflow-hidden">
      {/* Dark header */}
      <div className="bg-[#232f3e] text-white px-5 py-4">
        <h2 className="text-xl font-bold">{module.title}</h2>
        {module.subtitle && <p className="text-sm opacity-80 mt-0.5">{module.subtitle}</p>}
      </div>

      {/* Body */}
      <div className="p-5">
        {/* Tables */}
        {module.tables.map((t, i) => (
          <TableRenderer key={i} table={t} />
        ))}

        {/* Analysis sections */}
        {module.analysisSections.map((s, i) => (
          <AnalysisSectionRenderer key={i} section={s} />
        ))}

        {/* Highlight boxes */}
        {module.highlightBoxes.map((h, i) => (
          <HighlightBoxRenderer key={i} box={h} />
        ))}
      </div>
    </div>
  );
}

/* ─── Main Export ─── */

export interface ReportRendererProps {
  module: ReportModule;
}

export default function ReportRenderer({ module }: ReportRendererProps) {
  return (
    <div
      style={
        {
          '--amazon-primary': '#232f3e',
          '--amazon-accent': '#ff9900',
          '--amazon-secondary': '#146eb4',
        } as React.CSSProperties
      }
    >
      <ModuleCard module={module} />
    </div>
  );
}

export { badgeColor, riskColor, CellContent, TableRenderer, QuoteRenderer, KeyPointRenderer, AnalysisSectionRenderer, HighlightBoxRenderer, ModuleCard };
