'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toast, type ToastState } from '@/components/ui/Toast';

const TIME_REGEX = /^(0\d|1\d|2[0-3]):[0-5]\d$/;
const PINNED_TIMEZONE = 'Asia/Shanghai';

interface ConfigRow {
  domain_id: string;
  enabled: boolean;
  time_of_day: string;
  timezone: 'Asia/Shanghai';
}

/**
 * Admin-only form for daily_alert_configs (Account Health domain).
 * Fields: enabled (toggle), time_of_day (HH:MM text input), timezone (disabled,
 * pinned to Asia/Shanghai for V1 per Requirement 1.1).
 */
export function DailyAlertConfigForm() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [timeOfDay, setTimeOfDay] = useState('06:00');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/admin/daily-alert-configs', {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { data: ConfigRow | null };
        if (cancelled) return;
        if (body.data) {
          setEnabled(body.data.enabled);
          setTimeOfDay(body.data.time_of_day);
        }
      } catch (e) {
        if (!cancelled) {
          setToast({
            kind: 'error',
            text: e instanceof Error ? e.message : 'Failed to load',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const timeValid = TIME_REGEX.test(timeOfDay);

  const handleSave = async () => {
    if (!timeValid) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/daily-alert-configs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          time_of_day: timeOfDay,
          timezone: PINNED_TIMEZONE,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      setToast({
        kind: 'success',
        text: t('adminDailyAlert.config.savedToast'),
      });
    } catch (e) {
      setToast({
        kind: 'error',
        text:
          e instanceof Error
            ? e.message
            : t('adminDailyAlert.config.errorToast'),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-foreground-muted">{t('common.loading')}</p>;
  }

  return (
    <div className="space-y-5">
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        />
        {t('adminDailyAlert.config.enabled')}
      </label>

      <div>
        <label
          htmlFor="daily-time-of-day"
          className="mb-1.5 block text-sm font-medium text-foreground"
        >
          {t('adminDailyAlert.config.timeOfDay')}
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="daily-time-of-day"
            type="text"
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(e.target.value)}
            placeholder="06:00"
            className="w-28 font-mono"
          />
          <span className="text-sm text-foreground-muted">
            ({PINNED_TIMEZONE})
          </span>
        </div>
        {!timeValid && (
          <p className="mt-1.5 text-xs text-danger-fg">
            {t('adminDailyAlert.config.invalidTime')}
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="daily-timezone"
          className="mb-1.5 block text-sm font-medium text-foreground"
        >
          {t('adminDailyAlert.config.timezone')}
        </label>
        <Input
          id="daily-timezone"
          type="text"
          value={PINNED_TIMEZONE}
          disabled
          className="w-48 bg-muted text-foreground-muted"
        />
      </div>

      <Button onClick={handleSave} disabled={saving || !timeValid}>
        {saving ? '...' : t('adminDailyAlert.config.save')}
      </Button>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
