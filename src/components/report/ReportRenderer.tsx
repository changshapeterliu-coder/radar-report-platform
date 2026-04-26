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
    return 'bg-red-100 text-red-700 border border-red-300';
  if (l.includes('medium') || l.includes('recovery'))
    return 'bg-yellow-100 text-yellow-700 border border-yellow-300';
  return 'bg-blue-100 text-[#146eb4] border border-blue-300';
}

/* ─── Smart Paragraph Renderer ─── */

function SmartParagraph({ text, index }: { text: string; index: number }) {
  const trimmed = text.trim();

  // Detect if it's a quote (starts with quote marks or contains seller voice markers)
  const isQuote = /^[「""『]/.test(trimmed) ||
    trimmed.startsWith('"') ||
    trimmed.includes('seller said') ||
    trimmed.includes('卖家说') ||
    trimmed.includes('卖家反馈');

  // Detect if it's a short callout (< 80 chars and contains emphasis)
  const isCallout = trimmed.length < 80 && (
    trimmed.includes('：') || trimmed.includes(':') ||
    /^(关键|核心|重点|注意|警告|Key|Core|Important)/i.test(trimmed)
  );

  // Detect if it starts with a number/bullet pattern
  const numberedMatch = trimmed.match(/^(\d+)[\.\、\）\)]\s*(.+)/s);

  if (isQuote) {
    return (
      <blockquote className="relative bg-gradient-to-r from-[#fff9f0] to-white border-l-4 border-[#ff9900] rounded-r-lg p-5 my-5 shadow-sm">
        <svg className="absolute top-3 left-3 h-6 w-6 text-[#ff9900] opacity-30" fill="currentColor" viewBox="0 0 24 24">
          <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z" />
        </svg>
        <p className="text-base leading-relaxed text-gray-800 italic pl-8">{trimmed}</p>
      </blockquote>
    );
  }

  if (isCallout) {
    return (
      <div className="my-4 px-4 py-3 bg-blue-50 border-l-4 border-[#146eb4] rounded-r-md">
        <p className="text-base leading-relaxed text-[#232f3e] font-medium">{trimmed}</p>
      </div>
    );
  }

  if (numberedMatch) {
    const [, num, content] = numberedMatch;
    return (
      <div className="my-4 flex gap-3 items-start">
        <span className="flex-shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#ff9900] text-white text-sm font-bold shadow-sm">
          {num}
        </span>
        <p className="text-base leading-relaxed text-gray-800 pt-1">{content}</p>
      </div>
    );
  }

  // Regular paragraph — first paragraph gets drop cap styling
  const isFirst = index === 0;
  return (
    <p className={`text-base leading-relaxed text-gray-800 ${isFirst ? 'first-letter:text-3xl first-letter:font-bold first-letter:text-[#232f3e] first-letter:mr-1 first-letter:float-left first-letter:leading-tight' : ''}`}>
      {trimmed}
    </p>
  );
}

/* ─── Cell Renderer ─── */

function CellContent({ cell }: { cell: TableCell }) {
  return (
    <>
      <span className="text-sm">{cell.text}</span>
      {cell.badge && (
        <span
          className={`ml-2 inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${badgeColor(cell.badge.level)}`}
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
    <div className="my-6 rounded-lg overflow-hidden border border-gray-200 shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gradient-to-r from-[#f2f3f3] to-[#fafafa]">
              {table.headers.map((header, i) => (
                <th
                  key={i}
                  className="text-left px-4 py-3.5 font-semibold text-[#232f3e] border-b-2 border-[#ff9900]"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr
                key={ri}
                className={`${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/40 transition-colors`}
              >
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

/* ─── Quote Renderer ─── */

function QuoteRenderer({ quote }: { quote: Quote }) {
  return (
    <blockquote className="relative bg-gradient-to-r from-[#f8f9fa] to-white border-l-4 border-[#146eb4] rounded-r-lg p-5 my-5 shadow-sm">
      <svg className="absolute top-3 left-3 h-6 w-6 text-[#146eb4] opacity-30" fill="currentColor" viewBox="0 0 24 24">
        <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z" />
      </svg>
      <p className="text-base leading-relaxed text-gray-800 italic pl-8">{quote.text}</p>
      <span className="block mt-2 text-xs text-gray-500 not-italic pl-8">— {quote.source}</span>
    </blockquote>
  );
}

/* ─── KeyPoint Renderer ─── */

function KeyPointRenderer({ point }: { point: KeyPoint }) {
  return (
    <li className="mb-4 pl-2">
      <div className="flex items-baseline gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#ff9900] flex-shrink-0 translate-y-[-2px]" />
        <div>
          <span className="font-semibold text-[#232f3e]">{point.label}</span>
          <span className="text-gray-400 mx-1.5">·</span>
          <span className="text-gray-700 leading-relaxed">{point.content}</span>
          {point.impactTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
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
        </div>
      </div>
    </li>
  );
}

/* ─── AnalysisSection Renderer ─── */

function AnalysisSectionRenderer({ section }: { section: AnalysisSection }) {
  return (
    <div className="my-8 pb-6 border-b border-gray-100 last:border-b-0">
      <h3 className="relative text-xl mb-5 pl-4 text-[#232f3e] font-bold before:content-[''] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-1 before:h-6 before:bg-[#ff9900] before:rounded">
        {section.title}
      </h3>

      {section.quotes.map((q, i) => (
        <QuoteRenderer key={i} quote={q} />
      ))}

      {section.keyPoints.length > 0 && (
        <ul className="mt-4 list-none">
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
    <div className="relative my-5 rounded-lg overflow-hidden bg-gradient-to-br from-blue-50 to-white border border-blue-100 shadow-sm">
      <div className="absolute top-0 left-0 w-1 h-full bg-[#146eb4]" />
      <div className="p-5 pl-6">
        <div className="flex items-center gap-2 mb-2">
          <svg className="h-4 w-4 text-[#146eb4]" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <p className="font-bold text-[#232f3e]">{box.title}</p>
        </div>
        <p className="text-sm text-gray-700 leading-relaxed">{box.content}</p>
      </div>
    </div>
  );
}

/* ─── Module Card Renderer ─── */

function ModuleCard({ module }: { module: ReportModule }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-[#d5dbdb] mb-8 overflow-hidden">
      {/* Gradient header */}
      <div className="bg-gradient-to-r from-[#232f3e] to-[#37475a] text-white px-6 py-5">
        <h2 className="text-2xl font-bold tracking-tight">{module.title}</h2>
        {module.subtitle && <p className="text-sm opacity-80 mt-1">{module.subtitle}</p>}
      </div>

      {/* Body - max-width constrained for readability */}
      <div className="px-6 py-6 sm:px-10 sm:py-8">
        <div className="max-w-[780px] mx-auto">
          {/* Smart paragraphs */}
          {module.paragraphs && module.paragraphs.length > 0 && (
            <div className="mb-6 space-y-4">
              {module.paragraphs.map((p, i) => (
                <SmartParagraph key={i} text={p} index={i} />
              ))}
            </div>
          )}

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
