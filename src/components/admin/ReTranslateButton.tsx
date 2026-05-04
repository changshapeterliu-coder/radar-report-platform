'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Admin-only button: clears `content_translated` on the given entity and
 * enqueues an Inngest re-translate event.
 *
 * Used on:
 *   - /admin/reports/[id]/edit  (kind='report', endpoint=/api/admin/reports/[id]/re-translate)
 *   - /admin/news/[id]/edit     (kind='news',   endpoint=/api/admin/news/[id]/re-translate)
 *
 * UX: shows transient "queued" / error state next to the button; the actual
 * translation lands asynchronously (typically <60s via Inngest). The admin
 * can close the edit page; the updated content_translated will be present
 * on next view.
 */

export type ReTranslateEntity = 'report' | 'news';

export interface ReTranslateButtonProps {
  entity: ReTranslateEntity;
  id: string;
  className?: string;
}

export function ReTranslateButton({
  entity,
  id,
  className,
}: ReTranslateButtonProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>(
    'idle'
  );

  const handleClick = async () => {
    setStatus('pending');
    try {
      const endpoint =
        entity === 'report'
          ? `/api/admin/reports/${encodeURIComponent(id)}/re-translate`
          : `/api/admin/news/${encodeURIComponent(id)}/re-translate`;
      const res = await fetch(endpoint, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('success');
      window.setTimeout(() => setStatus('idle'), 3000);
    } catch {
      setStatus('error');
      window.setTimeout(() => setStatus('idle'), 3000);
    }
  };

  return (
    <div className={className}>
      <Button
        variant="outline"
        size="default"
        onClick={handleClick}
        disabled={status === 'pending'}
        type="button"
      >
        <Languages className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        {status === 'pending' ? '…' : t('adminActions.reTranslate')}
      </Button>
      {status === 'success' && (
        <span className="ml-3 text-xs text-success-fg">
          {t('adminActions.reTranslateQueued')}
        </span>
      )}
      {status === 'error' && (
        <span className="ml-3 text-xs text-danger-fg">
          {t('adminActions.reTranslateError')}
        </span>
      )}
    </div>
  );
}
