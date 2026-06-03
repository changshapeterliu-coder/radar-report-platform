'use client';

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Sparkles, X } from 'lucide-react';
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
import MarkdownContentEditor from './MarkdownContentEditor';
import { isV4Content } from '@/lib/validators/report-schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

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

  const updateCellBadge = (
    ri: number,
    ci: number,
    badgeText: string,
    level: 'high' | 'medium' | 'low'
  ) => {
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
    <div className="mb-3 rounded-md border border-border bg-muted/50 p-3">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {table.headers.map((h, i) => (
                <th key={i} className="p-1">
                  <div className="flex items-center gap-1">
                    <Input
                      value={h}
                      onChange={(e) => updateHeader(i, e.target.value)}
                      className="h-8 text-xs font-semibold"
                      placeholder="Header"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-foreground-muted hover:text-danger-fg"
                      onClick={() => removeColumn(i)}
                      aria-label="Remove column"
                      title="Remove column"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </Button>
                  </div>
                </th>
              ))}
              <th className="w-8 p-1" />
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr key={ri}>
                {row.cells.map((cell, ci) => (
                  <td key={ci} className="p-1 align-top">
                    <Input
                      value={cell.text}
                      onChange={(e) => updateCell(ri, ci, e.target.value)}
                      className="h-8 text-xs"
                      placeholder="Cell text"
                    />
                    <div className="mt-1 flex gap-1">
                      <Input
                        value={cell.badge?.text ?? ''}
                        onChange={(e) =>
                          updateCellBadge(
                            ri,
                            ci,
                            e.target.value,
                            cell.badge?.level ?? 'medium'
                          )
                        }
                        className="h-7 flex-1 text-[11px]"
                        placeholder="Badge"
                      />
                      <Select
                        value={cell.badge?.level ?? 'medium'}
                        onChange={(e) =>
                          updateCellBadge(
                            ri,
                            ci,
                            cell.badge?.text ?? '',
                            e.target.value as 'high' | 'medium' | 'low'
                          )
                        }
                        className="h-7 w-20 text-[11px]"
                      >
                        <option value="high">High</option>
                        <option value="medium">Med</option>
                        <option value="low">Low</option>
                      </Select>
                    </div>
                  </td>
                ))}
                <td className="p-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-foreground-muted hover:text-danger-fg"
                    onClick={() => removeRow(ri)}
                    aria-label="Remove row"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex gap-2">
        <Button variant="link" size="sm" onClick={addRow}>
          <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Row
        </Button>
        <Button variant="link" size="sm" onClick={addColumn}>
          <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Column
        </Button>
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

  const updateKeyPoint = (
    i: number,
    field: keyof KeyPoint,
    val: string | string[]
  ) => {
    const keyPoints = section.keyPoints.map((kp, idx) =>
      idx === i ? { ...kp, [field]: val } : kp
    );
    onChange({ ...section, keyPoints });
  };

  return (
    <div className="mb-3 rounded-md border border-border bg-muted/50 p-3">
      <Input
        value={section.title}
        onChange={(e) => onChange({ ...section, title: e.target.value })}
        className="mb-3 h-9 text-sm font-semibold"
        placeholder="Analysis section title"
      />

      {/* Quotes */}
      <p className="mb-1 text-xs font-semibold text-foreground-muted">Quotes</p>
      {section.quotes.map((q, i) => (
        <div key={i} className="mb-1 flex gap-2">
          <Input
            value={q.text}
            onChange={(e) => updateQuote(i, 'text', e.target.value)}
            className="h-8 flex-1 text-xs"
            placeholder="Quote text"
          />
          <Input
            value={q.source}
            onChange={(e) => updateQuote(i, 'source', e.target.value)}
            className="h-8 w-32 text-xs"
            placeholder="Source"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-foreground-muted hover:text-danger-fg"
            onClick={() =>
              onChange({
                ...section,
                quotes: section.quotes.filter((_, idx) => idx !== i),
              })
            }
            aria-label="Remove quote"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Button>
        </div>
      ))}
      <Button
        variant="link"
        size="sm"
        className="mb-2"
        onClick={() =>
          onChange({ ...section, quotes: [...section.quotes, emptyQuote()] })
        }
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Quote
      </Button>

      {/* Key Points */}
      <p className="mb-1 mt-2 text-xs font-semibold text-foreground-muted">
        Key Points
      </p>
      {section.keyPoints.map((kp, i) => (
        <div key={i} className="mb-1 flex flex-wrap gap-2">
          <Input
            value={kp.label}
            onChange={(e) => updateKeyPoint(i, 'label', e.target.value)}
            className="h-8 w-28 text-xs"
            placeholder="Label"
          />
          <Input
            value={kp.content}
            onChange={(e) => updateKeyPoint(i, 'content', e.target.value)}
            className="h-8 flex-1 text-xs"
            placeholder="Content"
          />
          <Input
            value={kp.impactTags.join(', ')}
            onChange={(e) =>
              updateKeyPoint(
                i,
                'impactTags',
                e.target.value
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean)
              )
            }
            className="h-8 w-40 text-xs"
            placeholder="Tags (comma-sep)"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-foreground-muted hover:text-danger-fg"
            onClick={() =>
              onChange({
                ...section,
                keyPoints: section.keyPoints.filter((_, idx) => idx !== i),
              })
            }
            aria-label="Remove key point"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Button>
        </div>
      ))}
      <Button
        variant="link"
        size="sm"
        onClick={() =>
          onChange({ ...section, keyPoints: [...section.keyPoints, emptyKeyPoint()] })
        }
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Key Point
      </Button>
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
    <div className="mb-2 flex gap-2">
      <Input
        value={box.title}
        onChange={(e) => onChange({ ...box, title: e.target.value })}
        className="h-8 w-40 text-xs"
        placeholder="Title"
      />
      <Input
        value={box.content}
        onChange={(e) => onChange({ ...box, content: e.target.value })}
        className="h-8 flex-1 text-xs"
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
    const tables = (module.tables ?? []).map((t, i) => (i === ti ? table : t));
    onChange({ ...module, tables });
  };

  const updateSection = (si: number, section: AnalysisSection) => {
    const analysisSections = (module.analysisSections ?? []).map((s, i) =>
      i === si ? section : s
    );
    onChange({ ...module, analysisSections });
  };

  const updateHighlight = (hi: number, box: HighlightBox) => {
    const highlightBoxes = (module.highlightBoxes ?? []).map((h, i) =>
      i === hi ? box : h
    );
    onChange({ ...module, highlightBoxes });
  };

  return (
    <div className="mb-4 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">
          Module {index + 1}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="text-danger-fg hover:bg-danger-bg hover:text-danger-fg"
          onClick={onRemove}
        >
          Remove Module
        </Button>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          value={module.title}
          onChange={(e) => onChange({ ...module, title: e.target.value })}
          placeholder="Module title"
        />
        <Input
          value={module.subtitle ?? ''}
          onChange={(e) => onChange({ ...module, subtitle: e.target.value })}
          placeholder="Subtitle (optional)"
        />
      </div>

      {/* Tables */}
      <p className="mb-1 text-sm font-semibold text-foreground-muted">Tables</p>
      {(module.tables ?? []).map((table, ti) => (
        <div key={ti} className="relative">
          <TableEditor table={table} onChange={(t) => updateTable(ti, t)} />
          {(module.tables ?? []).length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1 text-danger-fg hover:bg-danger-bg hover:text-danger-fg"
              onClick={() =>
                onChange({
                  ...module,
                  tables: (module.tables ?? []).filter((_, i) => i !== ti),
                })
              }
            >
              Remove Table
            </Button>
          )}
        </div>
      ))}
      <Button
        variant="link"
        size="sm"
        className="mb-3"
        onClick={() =>
          onChange({ ...module, tables: [...(module.tables ?? []), emptyTable()] })
        }
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Table
      </Button>

      {/* Analysis Sections */}
      <p className="mb-1 text-sm font-semibold text-foreground-muted">
        Analysis Sections
      </p>
      {(module.analysisSections ?? []).map((section, si) => (
        <div key={si} className="relative">
          <AnalysisSectionEditor
            section={section}
            onChange={(s) => updateSection(si, s)}
          />
          {(module.analysisSections ?? []).length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1 text-danger-fg hover:bg-danger-bg hover:text-danger-fg"
              onClick={() =>
                onChange({
                  ...module,
                  analysisSections: (module.analysisSections ?? []).filter(
                    (_, i) => i !== si
                  ),
                })
              }
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      <Button
        variant="link"
        size="sm"
        className="mb-3"
        onClick={() =>
          onChange({
            ...module,
            analysisSections: [
              ...(module.analysisSections ?? []),
              emptyAnalysisSection(),
            ],
          })
        }
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Analysis Section
      </Button>

      {/* Highlight Boxes */}
      <p className="mb-1 text-sm font-semibold text-foreground-muted">
        Highlight Boxes
      </p>
      {(module.highlightBoxes ?? []).map((box, hi) => (
        <div key={hi} className="flex items-start gap-1">
          <div className="flex-1">
            <HighlightBoxEditor box={box} onChange={(b) => updateHighlight(hi, b)} />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="mt-1 h-7 w-7 text-foreground-muted hover:text-danger-fg"
            onClick={() =>
              onChange({
                ...module,
                highlightBoxes: (module.highlightBoxes ?? []).filter(
                  (_, i) => i !== hi
                ),
              })
            }
            aria-label="Remove highlight box"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Button>
        </div>
      ))}
      <Button
        variant="link"
        size="sm"
        onClick={() =>
          onChange({
            ...module,
            highlightBoxes: [
              ...(module.highlightBoxes ?? []),
              emptyHighlightBox(),
            ],
          })
        }
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Highlight Box
      </Button>
    </div>
  );
}

/* ─── Smart Paste ─── */

// Transient topic-extraction summary returned alongside ReportContent by
// POST /api/ai/format-report. It is NOT part of ReportContent and must be
// stripped before the content enters editor state (see design: it must not be
// saved into reports.content). Kept local on purpose so this component does
// not couple to the new-report page's copy of the same shape.
type ModuleOutcome = 'ok' | 'empty' | 'failed';

interface ExtractionSummary {
  perModule: Array<{
    moduleIndex: number;
    title: string;
    extracted: number;
    dropped: number;
    outcome: ModuleOutcome;
  }>;
  total: number;
}

function SmartPasteSection({
  reportType,
  onResult,
}: {
  reportType: 'regular' | 'topic';
  onResult: (content: ReportContent) => void;
}) {
  const [rawText, setRawText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [extraction, setExtraction] = useState<ExtractionSummary | null>(null);

  const handleFormat = async () => {
    if (!rawText.trim()) return;
    setLoading(true);
    setError('');
    setExtraction(null);
    try {
      const res = await fetch('/api/ai/format-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawText, reportType }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'AI formatting failed');
        return;
      }
      // Strip the transient `extraction` summary so it never enters editor
      // state / reports.content; surface it as a non-blocking notice instead.
      const { extraction: extractionSummary, ...content } = data;
      onResult(content as ReportContent);
      if (extractionSummary) {
        setExtraction(extractionSummary as ExtractionSummary);
      }
      setRawText('');
    } catch {
      setError('Network error — could not reach AI service.');
    } finally {
      setLoading(false);
    }
  };

  const okModuleCount = extraction
    ? extraction.perModule.filter((p) => p.outcome === 'ok').length
    : 0;

  return (
    <div className="mb-6 rounded-lg border border-primary/40 bg-primary-soft p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Sparkles className="h-4 w-4 text-primary" strokeWidth={1.75} aria-hidden />
        Smart Paste · AI 智能格式化
      </h3>
      <p className="mb-2 text-xs text-foreground-muted">
        Paste your raw report text below and let AI structure it into modules,
        tables, and analysis sections.
      </p>
      <textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        rows={6}
        className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground transition-colors placeholder:text-foreground-subtle focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        placeholder="Paste raw report text here (Chinese or English)…&#10;&#10;Example:&#10;账户健康雷达报告 2025-03-03 ~ 2025-03-16&#10;一、政策违规概览&#10;IP投诉 45件 高风险&#10;产品真实性 23件 中风险&#10;…"
      />
      {error && <p className="mt-1 text-xs text-danger-fg">{error}</p>}
      <Button
        className="mt-2"
        onClick={handleFormat}
        disabled={loading || !rawText.trim()}
      >
        <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        {loading ? 'AI Processing…' : 'AI 智能格式化'}
      </Button>

      {extraction && (
        <div
          className="mt-3 rounded-md border border-border bg-primary-soft px-3 py-2.5 text-xs text-foreground-muted"
          role="status"
        >
          <p className="font-medium text-foreground">
            Extracted {extraction.total} topic
            {extraction.total === 1 ? '' : 's'} across {okModuleCount} module
            {okModuleCount === 1 ? '' : 's'} · 已提取 {extraction.total} 个话题
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {extraction.perModule.map((p) => (
              <li key={p.moduleIndex}>
                <span className="text-foreground">
                  {p.title || `Module ${p.moduleIndex + 1}`}
                </span>
                {': '}
                {p.outcome === 'ok' && (
                  <>
                    {p.extracted} topic{p.extracted === 1 ? '' : 's'} · 提取 {p.extracted} 个
                    {p.dropped > 0 && ` (${p.dropped} dropped · 丢弃 ${p.dropped})`}
                  </>
                )}
                {p.outcome === 'empty' && <>no topics found · 未发现话题</>}
                {p.outcome === 'failed' && <>extraction failed · 提取失败</>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ─── Main ContentEditor ─── */

export interface ContentEditorProps {
  value: ReportContent;
  onChange: (content: ReportContent) => void;
  reportType?: 'regular' | 'topic';
}

export default function ContentEditor({
  value,
  onChange,
  reportType = 'regular',
}: ContentEditorProps) {
  // v4 Markdown-hybrid drafts route to MarkdownContentEditor.
  // Pre-v4 drafts (blocks/tables/analysisSections) keep the legacy editor.
  if (isV4Content(value)) {
    return <MarkdownContentEditor value={value} onChange={onChange} />;
  }
  return (
    <LegacyContentEditor value={value} onChange={onChange} reportType={reportType} />
  );
}

function LegacyContentEditor({
  value,
  onChange,
  reportType = 'regular',
}: ContentEditorProps) {
  // useTranslation is reserved here for future i18n of admin labels — kept to
  // preserve existing import contract; not currently invoked.
  useTranslation();
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
      {/* Smart Paste */}
      <SmartPasteSection reportType={reportType} onResult={onChange} />

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Content Editor</h2>
        <Button
          variant="link"
          size="sm"
          onClick={() => setShowPreview(!showPreview)}
        >
          {showPreview ? 'Hide Preview' : 'Show Preview'}
        </Button>
      </div>

      <div className={showPreview ? 'grid grid-cols-1 gap-6 lg:grid-cols-2' : ''}>
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
            type="button"
            onClick={addModule}
            className="w-full rounded-md border-2 border-dashed border-border py-3 text-sm text-foreground-muted transition-colors hover:border-primary hover:text-primary"
          >
            + Add Module
          </button>
        </div>

        {/* Preview */}
        {showPreview && (
          <div className="max-h-[80vh] overflow-auto rounded-lg border border-border bg-muted/50 p-4">
            <p className="mb-2 text-sm font-semibold text-foreground-muted">
              Preview
            </p>
            {value.modules.length > 1 && (
              <div className="mb-3 flex gap-1 overflow-x-auto">
                {value.modules.map((m, i) => (
                  <button
                    type="button"
                    key={i}
                    onClick={() => setPreviewModuleIndex(i)}
                    className={
                      'whitespace-nowrap rounded-md px-3 py-1 text-xs transition-colors ' +
                      (i === previewModuleIndex
                        ? 'bg-primary text-primary-foreground'
                        : 'border border-border bg-card text-foreground-muted hover:bg-muted')
                    }
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
