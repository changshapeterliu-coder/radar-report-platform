'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Play, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Toast, type ToastState } from '@/components/ui/Toast';

export interface TriggerNowButtonProps {
  domainId: string;
}

interface ToastWithLink extends ToastState {
  link?: { href: string; label: string };
}

export function TriggerNowButton({ domainId }: TriggerNowButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [toast, setToast] = useState<ToastWithLink | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      const res = await fetch('/api/admin/scheduled-runs/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_id: domainId }),
      });

      if (res.status === 202) {
        setConfirming(false);
        setToast({
          kind: 'success',
          text: 'Run queued.',
          link: { href: '/admin/scheduled-runs', label: 'View runs' },
        });
        return;
      }

      if (res.status === 409) {
        setConfirming(false);
        setToast({
          kind: 'error',
          text: 'A run is already in progress for this window',
        });
        return;
      }

      const body = await res.json().catch(() => ({}));
      setConfirming(false);
      setToast({
        kind: 'error',
        text: body?.message || `Trigger failed (${res.status})`,
      });
    } catch {
      setConfirming(false);
      setToast({ kind: 'error', text: 'Network error' });
    } finally {
      setTriggering(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        <Play className="h-3.5 w-3.5" strokeWidth={2} />
        Trigger Now
      </Button>

      <ConfirmModal
        open={confirming}
        title="Trigger a manual run?"
        body={
          <p>
            This runs the dual-engine research pipeline immediately.
            Coverage window is computed from the current moment — typically
            the most recent completed Monday–Sunday in Asia/Shanghai.
          </p>
        }
        confirmLabel={triggering ? 'Triggering...' : 'Trigger'}
        cancelLabel="Cancel"
        onConfirm={handleTrigger}
        onCancel={() => setConfirming(false)}
        busy={triggering}
      />

      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50"
          role="status"
          aria-live="polite"
        >
          <div
            className={`rounded-md border px-4 py-3 text-sm shadow-md ${
              toast.kind === 'success'
                ? 'border-success/20 bg-success-bg text-success-fg'
                : 'border-danger/20 bg-danger-bg text-danger-fg'
            }`}
          >
            {toast.text}
            {toast.link && (
              <>
                {' '}
                <Link
                  href={toast.link.href}
                  className="inline-flex items-center gap-0.5 font-medium underline hover:no-underline"
                >
                  {toast.link.label}
                  <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
