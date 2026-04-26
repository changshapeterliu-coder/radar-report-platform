'use client';

import { useEffect, useMemo, useState } from 'react';

type Cadence = 'weekly' | 'biweekly';
type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

const DAY_OPTIONS: { value: DayOfWeek; label: string }[] = [
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' },
];

const TIME_REGEX = /^(0\d|1\d|2[0-3]):[0-5]\d$/;

const DAY_INDEX: Record<DayOfWeek, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
};

const DAY_SHORT: Record<DayOfWeek, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

/**
 * Get Asia/Shanghai wall-clock parts from a UTC instant.
 */
function getShanghaiParts(utc: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dowSun0: number; // 0=Sunday ... 6=Saturday
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(utc);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? '';
  const wdMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    dowSun0: wdMap[get('weekday')] ?? 0,
  };
}

/**
 * Build the UTC instant for a given Asia/Shanghai wall-clock (Shanghai = UTC+8, no DST).
 */
function shanghaiWallClockToUtc(y: number, m: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, m - 1, d, hh - 8, mm, 0));
}

/**
 * Compute the next Asia/Shanghai occurrence of the given day_of_week at time_of_day
 * that is strictly after "now". Returns a Date or null if inputs are invalid.
 */
function computeNextRun(dayOfWeek: DayOfWeek, timeOfDay: string, now: Date = new Date()): Date | null {
  if (!TIME_REGEX.test(timeOfDay)) return null;
  const [hhStr, mmStr] = timeOfDay.split(':');
  const hh = Number(hhStr);
  const mm = Number(mmStr);

  const nowParts = getShanghaiParts(now);
  const targetDow = DAY_INDEX[dayOfWeek];

  let addDays = (targetDow - nowParts.dowSun0 + 7) % 7;
  // If same weekday but target time already passed today, roll to next week.
  if (addDays === 0) {
    const todayTarget = shanghaiWallClockToUtc(nowParts.year, nowParts.month, nowParts.day, hh, mm);
    if (todayTarget.getTime() <= now.getTime()) {
      addDays = 7;
    }
  }

  return shanghaiWallClockToUtc(nowParts.year, nowParts.month, nowParts.day + addDays, hh, mm);
}

/**
 * Format a UTC Date as "Mon YYYY-MM-DD HH:MM Asia/Shanghai".
 */
function formatNextRun(utc: Date, dayOfWeek: DayOfWeek): string {
  const p = getShanghaiParts(utc);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${DAY_SHORT[dayOfWeek]} ${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)} Asia/Shanghai`;
}

export interface ScheduleConfigFormProps {
  domainId: string;
}

export function ScheduleConfigForm({ domainId }: ScheduleConfigFormProps) {
  const [enabled, setEnabled] = useState(false);
  const [cadence, setCadence] = useState<Cadence>('biweekly');
  const [dayOfWeek, setDayOfWeek] = useState<DayOfWeek>('monday');
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/schedule-config?domain_id=${encodeURIComponent(domainId)}`,
          { cache: 'no-store' }
        );
        if (!res.ok) {
          throw new Error(`Failed to load schedule config (${res.status})`);
        }
        const json = await res.json();
        if (cancelled) return;
        const row = json?.data as
          | { enabled: boolean; cadence: Cadence; day_of_week: DayOfWeek; time_of_day: string }
          | null;
        if (row) {
          setEnabled(Boolean(row.enabled));
          setCadence(row.cadence);
          setDayOfWeek(row.day_of_week);
          setTimeOfDay(row.time_of_day);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [domainId]);

  const timeValid = TIME_REGEX.test(timeOfDay);

  const nextRunText = useMemo(() => {
    if (!enabled || !timeValid) return null;
    const next = computeNextRun(dayOfWeek, timeOfDay);
    return next ? formatNextRun(next, dayOfWeek) : null;
  }, [enabled, dayOfWeek, timeOfDay, timeValid]);

  useEffect(() => {
    if (!success) return;
    const t = window.setTimeout(() => setSuccess(false), 3000);
    return () => window.clearTimeout(t);
  }, [success]);

  const handleSave = async () => {
    setError(null);
    setSuccess(false);
    if (!timeValid) {
      setError('Time of day must be in HH:MM format (00:00–23:59).');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/schedule-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain_id: domainId,
          enabled,
          cadence,
          day_of_week: dayOfWeek,
          time_of_day: timeOfDay,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `Save failed (${res.status})`);
      }
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-500">Loading schedule config...</p>;
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
        Enable scheduled runs
      </label>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Cadence</p>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm text-[#232f3e]">
            <input
              type="radio"
              name="cadence"
              value="weekly"
              checked={cadence === 'weekly'}
              onChange={() => setCadence('weekly')}
            />
            Weekly
          </label>
          <label className="flex items-center gap-2 text-sm text-[#232f3e]">
            <input
              type="radio"
              name="cadence"
              value="biweekly"
              checked={cadence === 'biweekly'}
              onChange={() => setCadence('biweekly')}
            />
            Biweekly
          </label>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="day-of-week">
          Day of Week
        </label>
        <select
          id="day-of-week"
          value={dayOfWeek}
          onChange={(e) => setDayOfWeek(e.target.value as DayOfWeek)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        >
          {DAY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="time-of-day">
          Time of Day
        </label>
        <div className="flex items-center gap-2">
          <input
            id="time-of-day"
            type="text"
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(e.target.value)}
            placeholder="09:00"
            className="w-24 rounded border border-gray-300 px-3 py-2 text-sm font-mono"
          />
          <span className="text-sm text-gray-500">(Asia/Shanghai)</span>
        </div>
        {!timeValid && (
          <p className="mt-1 text-xs text-red-600">
            Must be HH:MM (00:00–23:59).
          </p>
        )}
      </div>

      <div className="pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !timeValid}
          className="rounded bg-[#ff9900] px-4 py-2 text-sm font-medium text-white hover:bg-[#e88b00] disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Cadence'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-600">Saved ✓</p>}

      {nextRunText && (
        <p className="text-xs text-gray-500 pt-1">
          Next scheduled run: {nextRunText}
        </p>
      )}
    </div>
  );
}
