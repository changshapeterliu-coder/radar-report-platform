'use client';

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ReportContent,
  ReportModule,
  ReportTable,
  TableRow,
  TableCell,
  AnalysisSection,
  Quote,
  KeyPoint,
  HighlightBox,
} from '@/types/report';
import ReportRenderer from '@/components/report/ReportRenderer';

/* ─── Helpers ─── */

function emptyCell(): TableCell {
  return { text: '' };
}

function emptyRow(cols: number): TableRow {
  return { cells: Array.from({ length: cols }, emptyCell) };
}

function emptyTable(): ReportTable {
  return { headers: ['Column 1', 'Column 2'], rows: [emptyRow(2)] };
}

function emptyQuote(): Quote {
  return { text: '', source: '' };
}

function emptyKeyPoint(): KeyPoint {
  return { label: '', content: '', impactTags: [] };
}

function emptyAnalysisSection(): AnalysisSection {
  return { title: '', quotes: [], keyPoints: [] };
}

function emptyHighlightBox(): HighlightBox {
  return { title: '', content: '' };
}

function emptyModule(): ReportModule {
  return {
    title: '',
    subtitle: '',
    tables: [emptyTable()],
    analysisSections: [emptyAnalysisSection()],
    highlightBoxes: [],
  };
}

/* ─── Sub-editors ─── */

function TableEditor({
  table,
  onChange,
}: {
  table: ReportTable;
  onChange: (t: ReportTable) => void;
}) {
  const updateHeader = (i: number, val: string) => {
    const headers = [...table.headers];
    headers[i] = val;
    onChange({ ...table, headers });
  };

  const updateCell = (ri: number, ci: number, text: string) => {
    const rows = table.rows.map((r, idx) =>
      idx === ri
        ? { cells: r.cells.map((c, j) => (j === ci ? { ...c, text } : c)) }
        : r
    );
    onChange({ ...table, rows });
  };

  const updateCellBadge = (ri: number, ci: number, badgeText: string, level: 'high' | 'medium' | 'low') => {
    const rows = table.rows.map((r, idx) =>
      idx === ri
        ? {
            cells: r.cells.map((c, j) =>
              j === ci
                ? { ...c, badge: badgeText ? { text: badgeText, level } : undefined }
                : c
            ),
          }
        : r
    );
    onChange({ ...table, rows });
  };

  const addRow = () => {
    onChange({ ...table, rows: [...table.rows, emptyRow(table.headers.length)] });
  };

  const removeRow = (i: number) => {
    onChange({ ...table, rows: table.rows.filter((_, idx) => idx !== i) });
  };

  const addColumn = () => {
    onChange({
      headers: [...table.headers, `Column ${table.headers.length + 1}`],
      rows: table.rows.map((r) => ({
        cells: [...r.cells, emptyCell()],
      })),
    });
  };

  const removeColumn = (ci: number) => {
    if (table.headers.length <= 1) return;
    onChange({
      headers: table.headers.filter((_, i) => i !== ci),
      rows: table.rows.map((r) => ({
        cells: r.cells.filter((_, i) => i !== ci),
      })),
    });
  };

  return (
    <div className="border rounded p-3 mb-3 bg-gray-50">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              {table.headers.map((h, i) => (
                <th key={i} className="p-1">
                  <div className="flex gap-1">
                    <input
                      value={h}
                      onChange={(e) => updateHeader(i, e.target.value)}
                      className="w-full rounded border px-2 py-1 text-xs font-bold"
                      placeholder="Header"
                    />
                    <button
                      onClick={() => removeColumn(i)}
                      className="text-red-400 hover:text-red-600 text-xs px-1"
                      title="Remove column"
                    >
                      ×
                    </button>
                  </div>
                </th>
              ))}
              <th className="p-1 w-8" />
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr key={ri}>
                {row.cells.map((cell, ci) => (
                  <td key={ci} className="p-1">
                    <input
                      value={cell.text}
                      onChange={(e) => updateCell(ri, ci, e.target.value)}
                      className="w-full rounded border px-2 py-1 text-xs"
                      placeholder="Cell text"
                    />
                    <div className="flex gap-1 mt-0.5">
                      <input
                        value={cell.badge?.text ?? ''}
                        onChange={(e) =>
                          updateCellBadge(ri, ci, e.target.value, cell.badge?.level ?? 'medium')
                        }
                        className="flex-1 rounded border px-1 py-0.5 text-[10px]"
                        placeholder="Badge"
                      />
                      <select
                        value={cell.badge?.level ?? 'medium'}
                        onChange={(e) =>
                          updateCellBadge(
                            ri,
                            ci,
                            cell.badge?.text ?? '',
                            e.target.value as 'high' | 'medium' | 'low'
                          )
                        }
                        className="rounded border text-[10px] px-1"
                      >
                        <option value="high">High</option>
                        <option value="medium">Med</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                  </td>
                ))}
                <td className="p-1">
                  <button
                    onClick={() => removeRow(ri)}
                    className="text-red-400 hover:text-red-600 text-xs"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 mt-2">
        <button onClick={addRow} className="text-xs text-[#146eb4] hover:underline">
          + Row
        </button>
        <button onClick={addColumn} className="text-xs text-[#146eb4] hover:underline">
          + Column
        </button>
      </div>
    </div>
  );
}


function AnalysisSectionEditor({
  section,
  onChange,
}: {
  section: AnalysisSection;
  onChange: (s: AnalysisSection) => void;
}) {
  const updateQuote = (i: number, field: keyof Quote, val: string) => {
    const quotes = section.quotes.map((q, idx) =>
      idx === i ? { ...q, [field]: val } : q
    );
    onChange({ ...section, quotes });
  };

  const updateKeyPoint = (i: number, field: keyof KeyPoint, val: string | string[]) => {
    const keyPoints = section.keyPoints.map((kp, idx) =>
      idx === i ? { ...kp, [field]: val } : kp
    );
    onChange({ ...section, keyPoints });
  };

  return (
    <div className="border rounded p-3 mb-3 bg-gray-50">
      <input
        value={section.title}
        onChange={(e) => onChange({ ...section, title: e.target.value })}
        className="w-full rounded border px-2 py-1 text-sm font-semibold mb-2"
        placeholder="Analysis section title"
      />

      {/* Quotes */}
      <p className="text-xs font-bold text-gray-500 mb-1">Quotes</p>
      {section.quotes.map((q, i) => (
        <div key={i} className="flex gap-2 mb-1">
          <input
            value={q.text}
            onChange={(e) => updateQuote(i, 'text', e.target.value)}
            className="flex-1 rounded border px-2 py-1 text-xs"
            placeholder="Quote text"
          />
          <input
            value={q.source}
            onChange={(e) => updateQuote(i, 'source', e.target.value)}
            className="w-32 rounded border px-2 py-1 text-xs"
            placeholder="Source"
          />
          <button
            onClick={() =>
              onChange({ ...section, quotes: section.quotes.filter((_, idx) => idx !== i) })
            }
            className="text-red-400 hover:text-red-600 text-xs"
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange({ ...section, quotes: [...section.quotes, emptyQuote()] })}
        className="text-xs text-[#146eb4] hover:underline mb-2"
      >
        + Quote
      </button>

      {/* Key Points */}
      <p className="text-xs font-bold text-gray-500 mb-1 mt-2">Key Points</p>
      {section.keyPoints.map((kp, i) => (
        <div key={i} className="flex gap-2 mb-1 flex-wrap">
          <input
            value={kp.label}
            onChange={(e) => updateKeyPoint(i, 'label', e.target.value)}
            className="w-28 rounded border px-2 py-1 text-xs"
            placeholder="Label"
          />
          <input
            value={kp.content}
            onChange={(e) => updateKeyPoint(i, 'content', e.target.value)}
            className="flex-1 rounded border px-2 py-1 text-xs"
            placeholder="Content"
          />
          <input
            value={kp.impactTags.join(', ')}
            onChange={(e) =>
              updateKeyPoint(
                i,
                'impactTags',
                e.target.value.split(',').map((t) => t.trim()).filter(Boolean)
              )
            }
            className="w-40 rounded border px-2 py-1 text-xs"
            placeholder="Tags (comma-sep)"
          />
          <button
            onClick={() =>
              onChange({
                ...section,
                keyPoints: section.keyPoints.filter((_, idx) => idx !== i),
              })
            }
            className="text-red-400 hover:text-red-600 text-xs"
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          onChange({ ...section, keyPoints: [...section.keyPoints, emptyKeyPoint()] })
        }
        className="text-xs text-[#146eb4] hover:underline"
      >
        + Key Point
      </button>
    </div>
  );
}

function HighlightBoxEditor({
  box,
  onChange,
}: {
  box: HighlightBox;
  onChange: (b: HighlightBox) => void;
}) {
  return (
    <div className="flex gap-2 mb-2">
      <input
        value={box.title}
        onChange={(e) => onChange({ ...box, title: e.target.value })}
        className="w-40 rounded border px-2 py-1 text-xs"
        placeholder="Title"
      />
      <input
        value={box.content}
        onChange={(e) => onChange({ ...box, content: e.target.value })}
        className="flex-1 rounded border px-2 py-1 text-xs"
        placeholder="Content"
      />
    </div>
  );
}

/* ─── Module Editor ─── */

function ModuleEditor({
  module,
  index,
  onChange,
  onRemove,
}: {
  module: ReportModule;
  index: number;
  onChange: (m: ReportModule) => void;
  onRemove: () => void;
}) {
  const updateTable = (ti: number, table: ReportTable) => {
    const tables = module.tables.map((t, i) => (i === ti ? table : t));
    onChange({ ...module, tables });
  };

  const updateSection = (si: number, section: AnalysisSection) => {
    const analysisSections = module.analysisSections.map((s, i) =>
      i === si ? section : s
    );
    onChange({ ...module, analysisSections });
  };

  const updateHighlight = (hi: number, box: HighlightBox) => {
    const highlightBoxes = module.highlightBoxes.map((h, i) =>
      i === hi ? box : h
    );
    onChange({ ...module, highlightBoxes });
  };

  return (
    <div className="border rounded-lg p-4 mb-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-[#232f3e]">Module {index + 1}</h3>
        <button onClick={onRemove} className="text-red-500 hover:text-red-700 text-sm">
          Remove Module
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <input
          value={module.title}
          onChange={(e) => onChange({ ...module, title: e.target.value })}
          className="rounded border px-3 py-2 text-sm"
          placeholder="Module title"
        />
        <input
          value={module.subtitle ?? ''}
          onChange={(e) => onChange({ ...module, subtitle: e.target.value })}
          className="rounded border px-3 py-2 text-sm"
          placeholder="Subtitle (optional)"
        />
      </div>

      {/* Tables */}
      <p className="text-sm font-bold text-gray-600 mb-1">Tables</p>
      {module.tables.map((table, ti) => (
        <div key={ti} className="relative">
          <TableEditor table={table} onChange={(t) => updateTable(ti, t)} />
          {module.tables.length > 1 && (
            <button
              onClick={() =>
                onChange({ ...module, tables: module.tables.filter((_, i) => i !== ti) })
              }
              className="absolute top-1 right-1 text-red-400 hover:text-red-600 text-xs"
            >
              Remove Table
            </button>
          )}
        </div>
      ))}
      <button
        onClick={() => onChange({ ...module, tables: [...module.tables, emptyTable()] })}
        className="text-xs text-[#146eb4] hover:underline mb-3"
      >
        + Table
      </button>

      {/* Analysis Sections */}
      <p className="text-sm font-bold text-gray-600 mb-1">Analysis Sections</p>
      {module.analysisSections.map((section, si) => (
        <div key={si} className="relative">
          <AnalysisSectionEditor
            section={section}
            onChange={(s) => updateSection(si, s)}
          />
          {module.analysisSections.length > 1 && (
            <button
              onClick={() =>
                onChange({
                  ...module,
                  analysisSections: module.analysisSections.filter((_, i) => i !== si),
                })
              }
              className="absolute top-1 right-1 text-red-400 hover:text-red-600 text-xs"
            >
              Remove
            </button>
          )}
        </div>
      ))}
      <button
        onClick={() =>
          onChange({
            ...module,
            analysisSections: [...module.analysisSections, emptyAnalysisSection()],
          })
        }
        className="text-xs text-[#146eb4] hover:underline mb-3"
      >
        + Analysis Section
      </button>

      {/* Highlight Boxes */}
      <p className="text-sm font-bold text-gray-600 mb-1">Highlight Boxes</p>
      {module.highlightBoxes.map((box, hi) => (
        <div key={hi} className="flex items-start gap-1">
          <div className="flex-1">
            <HighlightBoxEditor box={box} onChange={(b) => updateHighlight(hi, b)} />
          </div>
          <button
            onClick={() =>
              onChange({
                ...module,
                highlightBoxes: module.highlightBoxes.filter((_, i) => i !== hi),
              })
            }
            className="text-red-400 hover:text-red-600 text-xs mt-1"
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          onChange({
            ...module,
            highlightBoxes: [...module.highlightBoxes, emptyHighlightBox()],
          })
        }
        className="text-xs text-[#146eb4] hover:underline"
      >
        + Highlight Box
      </button>
    </div>
  );
}

/* ─── Main ContentEditor ─── */

export interface ContentEditorProps {
  value: ReportContent;
  onChange: (content: ReportContent) => void;
}

export default function ContentEditor({ value, onChange }: ContentEditorProps) {
  const { t } = useTranslation();
  const [showPreview, setShowPreview] = useState(false);
  const [previewModuleIndex, setPreviewModuleIndex] = useState(0);

  const updateModule = useCallback(
    (index: number, mod: ReportModule) => {
      const modules = value.modules.map((m, i) => (i === index ? mod : m));
      onChange({ ...value, modules });
    },
    [value, onChange]
  );

  const removeModule = useCallback(
    (index: number) => {
      onChange({ ...value, modules: value.modules.filter((_, i) => i !== index) });
    },
    [value, onChange]
  );

  const addModule = useCallback(() => {
    onChange({ ...value, modules: [...value.modules, emptyModule()] });
  }, [value, onChange]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-[#232f3e]">Content Editor</h2>
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="text-sm text-[#146eb4] hover:underline"
        >
          {showPreview ? 'Hide Preview' : 'Show Preview'}
        </button>
      </div>

      <div className={showPreview ? 'grid grid-cols-1 lg:grid-cols-2 gap-6' : ''}>
        {/* Editor */}
        <div>
          {value.modules.map((mod, i) => (
            <ModuleEditor
              key={i}
              module={mod}
              index={i}
              onChange={(m) => updateModule(i, m)}
              onRemove={() => removeModule(i)}
            />
          ))}
          <button
            onClick={addModule}
            className="w-full rounded border-2 border-dashed border-gray-300 py-3 text-sm text-gray-500 hover:border-[#ff9900] hover:text-[#ff9900] transition-colors"
          >
            + Add Module
          </button>
        </div>

        {/* Preview */}
        {showPreview && (
          <div className="border rounded-lg p-4 bg-gray-50 overflow-auto max-h-[80vh]">
            <p className="text-sm font-bold text-gray-500 mb-2">Preview</p>
            {value.modules.length > 1 && (
              <div className="flex gap-1 mb-3 overflow-x-auto">
                {value.modules.map((m, i) => (
                  <button
                    key={i}
                    onClick={() => setPreviewModuleIndex(i)}
                    className={`px-3 py-1 rounded text-xs whitespace-nowrap ${
                      i === previewModuleIndex
                        ? 'bg-[#232f3e] text-white'
                        : 'bg-white border text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {m.title || `Module ${i + 1}`}
                  </button>
                ))}
              </div>
            )}
            {value.modules[previewModuleIndex] && (
              <ReportRenderer module={value.modules[previewModuleIndex]} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
