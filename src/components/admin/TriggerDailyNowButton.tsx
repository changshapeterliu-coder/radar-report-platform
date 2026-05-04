'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Toast, type ToastState } from '@/components/ui/Toast';
import { computeCoverageDate, toShanghai } from '@/lib/daily-alert/coverage-window';

/**
 * Admin-only "Trigger Now" button with confirm modal. Computes the coverage
 * date client-side for display (server recomputes authoritatively).
 * POST /api/admin/daily-alert-runs/trigger returns 202 on success, 409 when
 * a run is already in progress.
 */
export function TriggerDailyNowButton() {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const coverageDate = useMemo(
    () => computeCoverageDate(toShanghai(new Date())),
    // Re-compute each time the modal opens to avoid stale date across midnight
    [confirmOpen]
  );

  const handleTrigger = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/daily-alert-runs/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.status === 202) {
        setConfirmOpen(false);
        setToast({ kind: 'success', text: t('alerts.trigger.successToast') });
        return;
      }
      if (res.status === 409) {
        setConfirmOpen(false);
        setToast({
          kind: 'error',
          text: t('alerts.trigger.alreadyInProgressToast'),
        });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
      };
      setConfirmOpen(false);
      setToast({
        kind: 'error',
        text: body.message || t('alerts.trigger.errorToast'),
      });
    } catch {
      setConfirmOpen(false);
      setToast({ kind: 'error', text: t('alerts.trigger.errorToast') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
        <Play className="h-3.5 w-3.5" strokeWidth={2} />
        {t('alerts.trigger.button')}
      </Button>

      <ConfirmModal
        open={confirmOpen}
        title={t('alerts.trigger.confirmTitle')}
        body={
          <p>
            {t('alerts.trigger.confirmBody').replace('{date}', coverageDate)}
          </p>
        }
        confirmLabel={t('alerts.trigger.confirm')}
        cancelLabel={t('alerts.trigger.cancel')}
        onConfirm={handleTrigger}
        onCancel={() => setConfirmOpen(false)}
        busy={busy}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
