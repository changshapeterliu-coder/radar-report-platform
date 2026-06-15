'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, AlertCircle, Sparkles } from 'lucide-react';
import { AdminGuard } from '@/components/AdminGuard';
import { useDomain } from '@/contexts/DomainContext';
import ContentEditor from '@/components/admin/ContentEditor';
import { validateReportContent } from '@/lib/validators/content-validator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { ReportContent } from '@/types/report';

// Transient Smart Paste extraction summary (sibling of ReportContent in the
// /api/ai/format-report response). It is UI-only metadata — never folded into
// editor state and never saved into reports.content.
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

const defaultContent: ReportContent = {
  title: '',
  dateRange: '',
  modules: [
    {
      title: '',
      tables: [
        {
          headers: ['Column 1', 'Column 2'],
          rows: [{ cells: [{ text: '' }, { text: '' }] }],
        },
      ],
      analysisSections: [{ title: '', quotes: [], keyPoints: [] }],
      highlightBoxes: [],
    },
  ],
};

export default function CreateReportPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentDomainId, domains } = useDomain();

  const [title, setTitle] = useState('');
  const [type, setType] = useState<'regular' | 'topic'>('regular');
  const [dateRange, setDateRange] = useState('');
  const [weekLabel, setWeekLabel] = useState('');
  const [domainId, setDomainId] = useState(currentDomainId ?? '');

  useEffect(() => {
    if (currentDomainId && !domainId) {
      setDomainId(currentDomainId);
    }
  }, [currentDomainId, domainId]);

  const [content, setContent] = useState<ReportContent>(defaultContent);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const [aiRawText, setAiRawText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [extractionNotice, setExtractionNotice] = useState<ExtractionSummary | null>(null);

  const handleAiFormat = async () => {
    if (!aiRawText.trim()) return;
    setAiLoading(true);
    setAiError('');
    setExtractionNotice(null);
    try {
      const res = await fetch('/api/ai/format-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: aiRawText, reportType: type }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data.error || 'AI formatting failed');
        return;
      }
      // Strip the transient `extraction` summary so it never enters editor
      // state (it is sibling UI metadata, not part of ReportContent).
      const { extraction, ...content } = data as ReportContent & {
        extraction?: ExtractionSummary;
      };
      if (content.title) setTitle(content.title);
      if (content.dateRange) setDateRange(content.dateRange);
      setContent(content as ReportContent);
      if (extraction) setExtractionNotice(extraction);
      setAiRawText('');
    } catch {
      setAiError('Network error — could not reach AI service.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSave = async (publish: boolean) => {
    setErrors([]);
    if (!title.trim() || !dateRange.trim() || !domainId) {
      setErrors(['Title, date range, and domain are required.']);
      return;
    }

    const finalContent: ReportContent = {
      ...content,
      title: title.trim(),
      dateRange: dateRange.trim(),
    };

    const validationErrors = validateReportContent(finalContent, type);
    if (validationErrors.length > 0) {
      setErrors(validationErrors.map((e) => `${e.path}: ${e.message}`));
      return;
    }

    // Pre-publish gate (mirrors the server gate in /publish): a regular report
    // with no week_label collapses onto the dashboard trend chart's "null"
    // bucket and never shows as its own week. Block before creating a draft.
    if (publish && type === 'regular' && !weekLabel.trim()) {
      setErrors([
        'Week Label is required to publish a regular report — it drives the dashboard trend chart. 发布常规报告前请填写 Week Label（如 "W23-W24"）。',
      ]);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          type,
          date_range: dateRange.trim(),
          week_label: weekLabel.trim() || null,
          domain_id: domainId,
          content: finalContent,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setErrors([data.message || data.error || 'Failed to save report']);
        return;
      }

      const result = await res.json();
      const id = result.data?.id;

      if (publish && id) {
        const pubRes = await fetch(`/api/reports/${id}/publish`, { method: 'PUT' });
        if (!pubRes.ok) {
          const pubData = await pubRes.json().catch(() => ({}));
          setErrors([
            pubData.message ||
              'Report saved as draft, but publishing failed. Open it from the admin list to publish.',
          ]);
          return; // draft exists; stay so the user sees the reason
        }
      }

      router.push('/admin');
    } catch {
      setErrors(['Network error']);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminGuard>
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          {t('common.back')}
        </Button>
        <h1 className="mb-8 text-2xl font-semibold text-foreground">
          {t('admin.createReport')}
        </h1>

        {/* AI Format — paste entire report */}
        <div className="mb-6 rounded-lg border border-primary/30 bg-primary-soft/30 p-5">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles
              className="h-4 w-4 text-primary"
              strokeWidth={2}
              aria-hidden
            />
            <h3 className="text-sm font-semibold text-foreground">
              AI Format — auto-fill entire report
            </h3>
          </div>
          <p className="mb-3 text-xs text-foreground-muted">
            Paste the entire raw report text. AI will extract the title,
            date range, and all content modules automatically.
          </p>
          <textarea
            value={aiRawText}
            onChange={(e) => setAiRawText(e.target.value)}
            rows={6}
            className={cn(
              'flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle',
              'transition-colors resize-y',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:border-border-strong'
            )}
            placeholder="Paste full report text here (Chinese or English)..."
          />
          {aiError && (
            <p className="mt-1 text-xs text-danger-fg">{aiError}</p>
          )}
          <div className="mt-3">
            <Button
              onClick={handleAiFormat}
              disabled={aiLoading || !aiRawText.trim()}
              size="sm"
            >
              <Sparkles className="h-4 w-4" strokeWidth={2} />
              {aiLoading ? 'Processing...' : 'Format with AI'}
            </Button>
          </div>

          {extractionNotice && (
            <div className="mt-3 rounded-md bg-primary-soft px-3 py-2.5 text-xs text-foreground-muted">
              <p className="font-medium text-foreground">
                Extracted {extractionNotice.total}{' '}
                {extractionNotice.total === 1 ? 'topic' : 'topics'} across{' '}
                {extractionNotice.perModule.filter((m) => m.extracted > 0).length}{' '}
                {extractionNotice.perModule.filter((m) => m.extracted > 0).length === 1
                  ? 'module'
                  : 'modules'}
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {extractionNotice.perModule.map((m) => (
                  <li key={m.moduleIndex}>
                    module {m.moduleIndex + 1}
                    {m.title ? ` (${m.title})` : ''}:{' '}
                    {m.outcome === 'failed'
                      ? 'extraction failed'
                      : m.outcome === 'empty'
                        ? 'no topics found'
                        : `${m.extracted} ${m.extracted === 1 ? 'topic' : 'topics'}${
                            m.dropped > 0 ? ` (${m.dropped} dropped)` : ''
                          }`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {errors.length > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/20 bg-danger-bg px-3 py-2.5 text-sm text-danger-fg">
            <AlertCircle
              className="mt-0.5 h-4 w-4 flex-shrink-0"
              strokeWidth={1.75}
              aria-hidden
            />
            <div className="space-y-1">
              {errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="title"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Title
            </label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor="type"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Type
            </label>
            <Select
              id="type"
              value={type}
              onChange={(e) => setType(e.target.value as 'regular' | 'topic')}
            >
              <option value="regular">{t('reports.filterRegular')}</option>
              <option value="topic">{t('reports.filterTopic')}</option>
            </Select>
          </div>
          <div>
            <label
              htmlFor="dateRange"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Date Range
            </label>
            <Input
              id="dateRange"
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              placeholder="e.g. 2025-01-01 ~ 2025-01-15"
            />
          </div>
          <div>
            <label
              htmlFor="weekLabel"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Week Label
            </label>
            <Input
              id="weekLabel"
              value={weekLabel}
              onChange={(e) => setWeekLabel(e.target.value)}
              placeholder="e.g. W12, W12-W13, 2026-W15"
            />
          </div>
          <div>
            <label
              htmlFor="domain"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Domain
            </label>
            <Select
              id="domain"
              value={domainId}
              onChange={(e) => setDomainId(e.target.value)}
            >
              {domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Content Editor */}
        <ContentEditor value={content} onChange={setContent} reportType={type} />

        {/* Actions */}
        <div className="mt-6 flex gap-3">
          <Button
            variant="outline"
            onClick={() => handleSave(false)}
            disabled={saving}
          >
            {saving ? t('common.loading') : `${t('common.save')} (Draft)`}
          </Button>
          <Button onClick={() => handleSave(true)} disabled={saving}>
            {saving ? t('common.loading') : t('admin.publish')}
          </Button>
        </div>
      </div>
    </AdminGuard>
  );
}
