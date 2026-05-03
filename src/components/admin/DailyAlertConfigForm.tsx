'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
        const res = await fetch('/api/admin/daily-alert-configs', { cache: 'no-store' });
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
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      setToast({ kind: 'success', text: t('adminDailyAlert.config.savedToast') });
    } catch (e) {
      setToast({
        kind: 'error',
        text: e instanceof Error ? e.message : t('adminDailyAlert.config.errorToast'),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-500">{t('common.loading')}</p>;
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-[#232f3e]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4"
        />
        {t('adminDailyAlert.config.enabled')}
      </label>

      <div>
        <label
          htmlFor="daily-time-of-day"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {t('adminDailyAlert.config.timeOfDay')}
        </label>
        <div className="flex items-center gap-2">
          <input
            id="daily-time-of-day"
            type="text"
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(e.target.value)}
            placeholder="06:00"
            className="w-24 rounded border border-gray-300 px-3 py-2 text-sm font-mono focus:border-[#ff9900] focus:outline-none"
          />
          <span className="text-sm text-gray-500">({PINNED_TIMEZONE})</span>
        </div>
        {!timeValid && (
          <p className="mt-1 text-xs text-red-600">
            {t('adminDailyAlert.config.invalidTime')}
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="daily-timezone"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {t('adminDailyAlert.config.timezone')}
        </label>
        <input
          id="daily-timezone"
          type="text"
          value={PINNED_TIMEZONE}
          disabled
          className="w-48 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
        />
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !timeValid}
        className="rounded bg-[#ff9900] px-4 py-2 text-sm font-medium text-white hover:bg-[#e88b00] disabled:opacity-50"
      >
        {saving ? '...' : t('adminDailyAlert.config.save')}
      </button>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
