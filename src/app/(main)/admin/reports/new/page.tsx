'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { AdminGuard } from '@/components/AdminGuard';
import { useDomain } from '@/contexts/DomainContext';
import { useAuth } from '@/hooks/useAuth';
import ContentEditor from '@/components/admin/ContentEditor';
import { validateReportContent } from '@/lib/validators/content-validator';
import type { ReportContent } from '@/types/report';

const defaultContent: ReportContent = {
  title: '',
  dateRange: '',
  modules: [
    {
      title: '',
      tables: [{ headers: ['Column 1', 'Column 2'], rows: [{ cells: [{ text: '' }, { text: '' }] }] }],
      analysisSections: [{ title: '', quotes: [], keyPoints: [] }],
      highlightBoxes: [],
    },
  ],
};

export default function CreateReportPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentDomainId, domains } = useDomain();
  const { user } = useAuth();

  const [title, setTitle] = useState('');
  const [type, setType] = useState<'regular' | 'topic'>('regular');
  const [dateRange, setDateRange] = useState('');
  const [domainId, setDomainId] = useState(currentDomainId ?? '');
  const [content, setContent] = useState<ReportContent>(defaultContent);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

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

    setSaving(true);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          type,
          date_range: dateRange.trim(),
          domain_id: domainId,
          content: finalContent,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setErrors([data.error || 'Failed to save report']);
        return;
      }

      const { id } = await res.json();

      if (publish && id) {
        await fetch(`/api/reports/${id}/publish`, { method: 'PUT' });
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
        <button onClick={() => router.back()} className="mb-4 text-sm text-[#146eb4] hover:underline">
          ← {t('common.back')}
        </button>
        <h1 className="text-2xl font-bold text-[#232f3e] mb-6">{t('admin.createReport')}</h1>

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
        <ContentEditor value={content} onChange={setContent} />

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {saving ? t('common.loading') : t('common.save')} (Draft)
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            className="rounded bg-[#ff9900] px-4 py-2 text-sm font-medium text-white hover:bg-[#e88b00] disabled:opacity-50"
          >
            {saving ? t('common.loading') : t('admin.publish')}
          </button>
        </div>
      </div>
    </AdminGuard>
  );
}
