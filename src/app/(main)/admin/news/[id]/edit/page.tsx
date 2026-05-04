'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { AdminGuard } from '@/components/AdminGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SpinnerBlock } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

export default function EditNewsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
        <SpinnerBlock />
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
          Back to Admin
        </Button>
        <h1 className="mb-8 text-2xl font-semibold text-foreground">
          Edit News
        </h1>

        {error && (
          <div className="mb-4 flex max-w-2xl items-start gap-2 rounded-md border border-danger/20 bg-danger-bg px-3 py-2.5 text-sm text-danger-fg">
            <AlertCircle
              className="mt-0.5 h-4 w-4 flex-shrink-0"
              strokeWidth={1.75}
              aria-hidden
            />
            <span>{error}</span>
          </div>
        )}

        <div className="max-w-2xl space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
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
              htmlFor="summary"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Summary{' '}
              <span className="text-foreground-subtle">(optional)</span>
            </label>
            <Input
              id="summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor="content"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Content
            </label>
            <textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              className={cn(
                'flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle',
                'transition-colors resize-y',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:border-border-strong'
              )}
            />
          </div>
          <div>
            <label
              htmlFor="channel"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Source Channel
            </label>
            <Input
              id="channel"
              value={sourceChannel}
              onChange={(e) => setSourceChannel(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push('/admin')}
          >
            Cancel
          </Button>
        </div>
      </div>
    </AdminGuard>
  );
}
