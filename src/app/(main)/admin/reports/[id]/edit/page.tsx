'use client';

import { useEffect, useState, useMemo, use } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { AdminGuard } from '@/components/AdminGuard';
import { createClient } from '@/lib/supabase/client';
import { useDomain } from '@/contexts/DomainContext';
import ContentEditor from '@/components/admin/ContentEditor';
import DisclaimerBanner from '@/components/DisclaimerBanner';
import { validateReportContent } from '@/lib/validators/content-validator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SpinnerBlock } from '@/components/ui/spinner';
import { ReTranslateButton } from '@/components/admin/ReTranslateButton';
import type { ReportContent } from '@/types/report';
import type { Database } from '@/types/database';

type ReportRow = Database['public']['Tables']['reports']['Row'];

export default function EditReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { t } = useTranslation();
  const router = useRouter();
  const { domains } = useDomain();
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const [title, setTitle] = useState('');
  const [type, setType] = useState<'regular' | 'topic'>('regular');
  const [dateRange, setDateRange] = useState('');
  const [weekLabel, setWeekLabel] = useState('');
  const [domainId, setDomainId] = useState('');
  const [content, setContent] = useState<ReportContent>({
    title: '',
    dateRange: '',
    modules: [],
  });

  useEffect(() => {
    async function fetchReport() {
      try {
        const { data, error: fetchError } = await supabase
          .from('reports')
          .select('*')
          .eq('id', id)
          .single();

        if (fetchError || !data) {
          setError('Report not found');
          setLoading(false);
          return;
        }

        const report = data as ReportRow;
        setTitle(report.title);
        setType(report.type);
        setDateRange(report.date_range);
        setWeekLabel(report.week_label ?? '');
        setDomainId(report.domain_id);
        setContent(report.content as ReportContent);
      } catch {
        setError('Network error');
      }
      setLoading(false);
    }
    fetchReport();
  }, [id, supabase]);

  const handleSave = async () => {
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

    setSaving(true);
    try {
      const res = await fetch(`/api/reports/${id}`, {
        method: 'PUT',
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
        setErrors([data.message || 'Failed to save report']);
        setSaving(false);
        return;
      }

      router.push('/admin');
    } catch {
      setErrors(['Network error']);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AdminGuard>
        <SpinnerBlock />
      </AdminGuard>
    );
  }

  if (error) {
    return (
      <AdminGuard>
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="mb-4 -ml-2"
            onClick={() => router.push('/admin')}
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
            {t('common.back')}
          </Button>
          <div className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger-bg p-4 text-sm text-danger-fg">
            <AlertCircle
              className="mt-0.5 h-4 w-4 flex-shrink-0"
              strokeWidth={1.75}
              aria-hidden
            />
            <span>{error}</span>
          </div>
        </div>
      </AdminGuard>
    );
  }

  return (
    <AdminGuard>
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2"
          onClick={() => router.push('/admin')}
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          {t('common.back')}
        </Button>
        <h1 className="mb-6 text-2xl font-semibold text-foreground">
          Edit Report
        </h1>

        <DisclaimerBanner className="mb-6" />

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
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push('/admin')}
          >
            Cancel
          </Button>
          <ReTranslateButton entity="report" id={id} className="ml-auto" />
        </div>
      </div>
    </AdminGuard>
  );
}
