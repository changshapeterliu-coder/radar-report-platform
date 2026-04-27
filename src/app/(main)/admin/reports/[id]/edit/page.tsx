'use client';

import { useEffect, useState, useMemo, use } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { AdminGuard } from '@/components/AdminGuard';
import { createClient } from '@/lib/supabase/client';
import { useDomain } from '@/contexts/DomainContext';
import ContentEditor from '@/components/admin/ContentEditor';
import DisclaimerBanner from '@/components/DisclaimerBanner';
import { validateReportContent } from '@/lib/validators/content-validator';
import type { ReportContent } from '@/types/report';
import type { Database } from '@/types/database';

type ReportRow = Database['public']['Tables']['reports']['Row'];

export default function EditReportPage({ params }: { params: Promise<{ id: string }> }) {
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
        <div className="flex justify-center py-12">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#ff9900] border-r-transparent" />
        </div>
      </AdminGuard>
    );
  }

  if (error) {
    return (
      <AdminGuard>
        <div>
          <button onClick={() => router.push('/admin')} className="mb-4 text-sm text-[#146eb4] hover:underline">
            ← {t('common.back')}
          </button>
          <div className="rounded border border-red-300 bg-red-50 p-4">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        </div>
      </AdminGuard>
    );
  }

  return (
    <AdminGuard>
      <div>
        <button onClick={() => router.push('/admin')} className="mb-4 text-sm text-[#146eb4] hover:underline">
          ← {t('common.back')}
        </button>
        <h1 className="text-2xl font-bold text-[#232f3e] mb-6">✏️ Edit Report</h1>

        <DisclaimerBanner className="mb-6" />

        {errors.length > 0 && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 p-3">
            {errors.map((e, i) => (
              <p key={i} className="text-sm text-red-600">{e}</p>
            ))}
          </div>
        )}

        {/* Metadata */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#ff9900] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'regular' | 'topic')}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="regular">{t('reports.filterRegular')}</option>
              <option value="topic">{t('reports.filterTopic')}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date Range</label>
            <input
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              placeholder="e.g. 2025-01-01 ~ 2025-01-15"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#ff9900] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Week Label</label>
            <input
              value={weekLabel}
              onChange={(e) => setWeekLabel(e.target.value)}
              placeholder="e.g. W12, W12-W13, 2026-W15"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#ff9900] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Domain</label>
            <select
              value={domainId}
              onChange={(e) => setDomainId(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              {domains.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Content Editor */}
        <ContentEditor value={content} onChange={setContent} reportType={type} />

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-[#ff9900] px-4 py-2 text-sm font-medium text-white hover:bg-[#e88b00] disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            onClick={() => router.push('/admin')}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </AdminGuard>
  );
}
