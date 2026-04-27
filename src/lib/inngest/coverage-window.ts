import type { CoverageWindow } from '@/types/scheduled-runs';

const SHANGHAI_TZ = 'Asia/Shanghai';

type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

/**
 * Minimal ScheduleConfig row shape needed by shouldFire. Avoids importing
 * the full Database type into this pure-function module.
 */
export interface ScheduleConfigTickInput {
  enabled: boolean;
  day_of_week: DayOfWeek;
  /** "HH:MM" in 24-hour format. */
  time_of_day: string;
}

/**
 * Extracts Asia/Shanghai wall-clock parts from a UTC instant.
 */
function toShanghaiParts(utc: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: DayOfWeek;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: SHANGHAI_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
  });
  const parts = fmt.formatToParts(utc);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const weekdayMap: Record<string, DayOfWeek> = {
    Monday: 'monday',
    Tuesday: 'tuesday',
    Wednesday: 'wednesday',
    Thursday: 'thursday',
    Friday: 'friday',
    Saturday: 'saturday',
    Sunday: 'sunday',
  };

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    dayOfWeek: weekdayMap[get('weekday')] ?? 'monday',
  };
}

/**
 * Constructs a UTC Date from Asia/Shanghai wall-clock components.
 *
 * Asia/Shanghai is UTC+8 year-round (no DST). We compute the UTC instant
 * that, when rendered in Shanghai, equals the given wall-clock.
 */
function shanghaiWallClockToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  second = 0
): Date {
  // Asia/Shanghai = UTC+8 constant. UTC instant = Shanghai wall-clock - 8h.
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second));
}

/**
 * Returns the Asia/Shanghai Monday of the week containing the given instant.
 * If the instant is itself Monday (Shanghai wall-clock), returns that day.
 */
function mondayOfShanghaiWeek(utc: Date): {
  year: number;
  month: number;
  day: number;
} {
  const parts = toShanghaiParts(utc);
  const dowMap: Record<DayOfWeek, number> = {
    monday: 0,
    tuesday: 1,
    wednesday: 2,
    thursday: 3,
    friday: 4,
    saturday: 5,
    sunday: 6,
  };
  const offsetDays = dowMap[parts.dayOfWeek];
  // Walk back via UTC arithmetic (day-length stable because no DST).
  const mondayUtc = shanghaiWallClockToUtc(
    parts.year,
    parts.month,
    parts.day - offsetDays,
    0,
    0,
    0
  );
  const mondayParts = toShanghaiParts(mondayUtc);
  return {
    year: mondayParts.year,
    month: mondayParts.month,
    day: mondayParts.day,
  };
}

/**
 * Formats a two-digit zero-padded day (1 → "01", 12 → "12").
 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * ISO 8601 week number for an Asia/Shanghai calendar date.
 *
 * ISO rules: week 1 = the week containing the year's first Thursday. Week
 * boundaries are Monday-Sunday. A year can have 52 or 53 weeks.
 *
 * We compute on Shanghai wall-clock so that a date like 2026-01-01 Shanghai
 * gets its correct week number regardless of UTC offset.
 */
function isoWeekNumberShanghai(utc: Date): number {
  const p = toShanghaiParts(utc);
  // Algorithm: make a UTC Date from the Shanghai Y-M-D, then apply the
  // classic "Thursday of ISO week" trick.
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  // ISO day-of-week: Mon=1..Sun=7
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  // Shift to the Thursday of this week (ISO week = Thursday's week).
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7
  );
  return weekNum;
}

/**
 * Formats a Shanghai-local ISO date as `YYYY-MM-DD`.
 */
function formatShanghaiDate(utc: Date): string {
  const p = toShanghaiParts(utc);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/**
 * Computes the Coverage_Window given a trigger instant and cadence.
 *
 * Weekly: start = previous Monday 00:00 Shanghai, end = previous Sunday 23:59:59 Shanghai.
 * Biweekly: end is the same; start is end - 14 days + 1 minute (spans 14 days).
 *
 * "Previous" means: if trigger is on a Monday, the window covers the 7 or 14
 * days ending on the immediately preceding Sunday.
 */
export function computeCoverageWindow(
  triggerUtc: Date,
  cadence: 'weekly' | 'biweekly'
): CoverageWindow {
  const currentMonday = mondayOfShanghaiWeek(triggerUtc);
  // End = immediately preceding Sunday 23:59:59 Shanghai = current Monday - 1 sec.
  const endUtc = shanghaiWallClockToUtc(
    currentMonday.year,
    currentMonday.month,
    currentMonday.day,
    0,
    0,
    -1
  );
  // Start = previous Monday 00:00 Shanghai (weekly) OR 14 days earlier (biweekly).
  const startOffsetDays = cadence === 'weekly' ? 7 : 14;
  const startUtc = shanghaiWallClockToUtc(
    currentMonday.year,
    currentMonday.month,
    currentMonday.day - startOffsetDays,
    0,
    0,
    0
  );
  const weekLabel = computeWeekLabel(startUtc, endUtc);
  return {
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString(),
    weekLabel,
  };
}

/**
 * Standalone week-label formatter (exposed for tests).
 *
 * Returns ISO week number(s) without year:
 *   - Single week: `W16`
 *   - Multi week:  `W16-W17`
 * Used for display in titles and as a stable key for dashboard trend grouping.
 */
export function computeWeekLabel(startUtc: Date, endUtc: Date): string {
  const startWeek = isoWeekNumberShanghai(startUtc);
  const endWeek = isoWeekNumberShanghai(endUtc);
  return startWeek === endWeek
    ? `W${pad2(startWeek)}`
    : `W${pad2(startWeek)}-W${pad2(endWeek)}`;
}

/**
 * Human-readable Shanghai-local date range: `YYYY-MM-DD ~ YYYY-MM-DD`.
 * Exposed for the synthesizer prompt so the generated report carries a
 * clean date string rather than the raw UTC ISO timestamps.
 */
export function formatDateRange(startUtc: Date, endUtc: Date): string {
  return `${formatShanghaiDate(startUtc)} ~ ${formatShanghaiDate(endUtc)}`;
}

/**
 * Returns true iff the schedule should fire at the given UTC instant.
 * Matches on Asia/Shanghai day-of-week AND HH:MM to the minute.
 */
export function shouldFire(
  config: ScheduleConfigTickInput,
  nowUtc: Date
): boolean {
  if (!config.enabled) return false;
  const parts = toShanghaiParts(nowUtc);
  if (parts.dayOfWeek !== config.day_of_week) return false;
  const hhmm = `${pad2(parts.hour)}:${pad2(parts.minute)}`;
  return hhmm === config.time_of_day;
}
