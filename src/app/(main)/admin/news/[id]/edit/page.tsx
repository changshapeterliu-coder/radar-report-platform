'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { AdminGuard } from '@/components/AdminGuard';

export default function EditNewsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [sourceChannel, setSourceChannel] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchNews() {
      try {
        const res = await fetch(`/api/news/${id}`);
        if (!res.ok) {
          setError('Failed to load news item');
          setLoading(false);
          return;
        }
        const { data } = await res.json();
        setTitle(data.title ?? '');
        setSummary(data.summary ?? '');
        setContent(data.content ?? '');
        setSourceChannel(data.source_channel ?? '');
      } catch {
        setError('Network error');
      }
      setLoading(false);
    }
    fetchNews();
  }, [id]);

  const handleSave = async () => {
    setError('');
    if (!title.trim() || !content.trim()) {
      setError('Title and content are required.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/news/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          summary: summary.trim() || null,
          content: content.trim(),
          source_channel: sourceChannel.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.message || 'Failed to save');
        setSaving(false);
        return;
      }
      router.push('/admin');
    } catch {
      setError('Network error');
    }
    setSaving(false);
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

  return (
    <AdminGuard>
      <div>
        <button onClick={() => router.push('/admin')} className="mb-4 text-sm text-[#146eb4] hover:underline">
          ← Back to Admin
        </button>
        <h1 className="text-2xl font-bold text-[#232f3e] mb-6">✏️ Edit News</h1>

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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Source Channel</label>
            <input
              value={sourceChannel}
              onChange={(e) => setSourceChannel(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#ff9900] focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-6 flex gap-3">
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
