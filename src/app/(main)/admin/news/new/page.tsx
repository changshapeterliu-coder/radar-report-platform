'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { AdminGuard } from '@/components/AdminGuard';
import { useDomain } from '@/contexts/DomainContext';

export default function CreateNewsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentDomainId, domains } = useDomain();

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [sourceChannel, setSourceChannel] = useState('');
  const [domainId, setDomainId] = useState(currentDomainId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setError('');
    if (!title.trim() || !content.trim() || !sourceChannel.trim() || !domainId) {
      setError('Title, content, source channel, and domain are required.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          summary: summary.trim() || null,
          content: content.trim(),
          source_channel: sourceChannel.trim(),
          domain_id: domainId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to save news');
        return;
      }

      router.push('/admin');
    } catch {
      setError('Network error');
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
        <h1 className="text-2xl font-bold text-[#232f3e] mb-6">{t('admin.createNews')}</h1>

        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 p-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="space-y-4 max-w-2xl">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#ff9900] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Summary (optional)</label>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#ff9900] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#ff9900] focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Source Channel</label>
              <input
                value={sourceChannel}
                onChange={(e) => setSourceChannel(e.target.value)}
                placeholder="e.g. Internal, External, Community"
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
        </div>

        <div className="mt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-[#ff9900] px-4 py-2 text-sm font-medium text-white hover:bg-[#e88b00] disabled:opacity-50"
          >
            {saving ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </div>
    </AdminGuard>
  );
}
