'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Toast {
  kind: 'success' | 'error';
  text: string;
  link?: { href: string; label: string };
}

export interface TriggerNowButtonProps {
  domainId: string;
}

export function TriggerNowButton({ domainId }: TriggerNowButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

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
          link: { href: '/admin/scheduled-runs', label: 'View runs →' },
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
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-[#232f3e] hover:border-[#ff9900] hover:text-[#ff9900]"
      >
        ▶ Trigger Now
      </button>

      {confirming && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-[#232f3e] mb-2">
              Trigger a manual run?
            </h2>
            <p className="text-sm text-gray-600">
              This will run the dual-engine research pipeline now. Coverage window is
              computed from the current moment — typically the most recent completed
              Monday–Sunday in Asia/Shanghai.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={triggering}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-[#232f3e] hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleTrigger}
                disabled={triggering}
                className="rounded bg-[#ff9900] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#e88b00] disabled:opacity-50"
              >
                {triggering ? 'Triggering...' : 'Trigger'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50">
          <div
            className={`rounded border px-4 py-3 text-sm shadow-md ${
              toast.kind === 'success'
                ? 'border-green-300 bg-green-50 text-green-700'
                : 'border-red-300 bg-red-50 text-red-700'
            }`}
          >
            {toast.text}
            {toast.link && (
              <>
                {' '}
                <Link
                  href={toast.link.href}
                  className="font-medium underline hover:no-underline"
                >
                  {toast.link.label}
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
