'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { AdminGuard } from '@/components/AdminGuard';
import { useDomain } from '@/contexts/DomainContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

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
    if (
      !title.trim() ||
      !content.trim() ||
      !sourceChannel.trim() ||
      !domainId
    ) {
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
          {t('admin.createNews')}
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                placeholder="e.g. Internal, External, Community"
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
        </div>

        <div className="mt-6 flex gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
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
