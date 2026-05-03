/**
 * Coverage window computation (Asia/Shanghai).
 *
 * The daily alert's "coverage window" is **the previous Asia/Shanghai
 * calendar day, 00:00:00 → 23:59:59, regardless of host timezone**.
 *
 * All functions here are pure — no I/O, no Supabase, no Inngest, no
 * side-effects. Timezone math is done via `Intl.DateTimeFormat` with
 * `timeZone: 'Asia/Shanghai'`, which is the Node-built-in portable way
 * to interpret an instant in that TZ without taking a `date-fns-tz`
 * dependency.
 *
 * Spec: .kiro/specs/daily-hot-topic-alert/
 *   Requirements: 1.1, 1.6, 2.1, 2.3, 3.2, 15.1, 15.2
 *   Design:       §组件与接口 §2 (daily-alert-tick)
 * Property refs (PBT):
 *   P1  — Coverage window spans exactly 24h minus 1s
 *   P37 — Timezone-independent schedule firing
 */

import type { DailyAlertConfigRow } from '@/types/daily-alert';

/**
 * "Now" decomposed into Asia/Shanghai wall-clock fields.
 *
 * Includes pre-formatted strings (HHMM `'06:00'`-style, dateStr `'YYYY-MM-DD'`)
 * to avoid repeating `Intl.DateTimeFormat` plumbing at call sites.
 */
export interface ShanghaiNow {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  HHMM: string; // 'HH:MM', e.g. '06:00'
  dateStr: string; // 'YYYY-MM-DD'
}

/**
 * Convert a UTC `Date` into Asia/Shanghai wall-clock components.
 *
 * Independent of host TZ — always produces the correct Shanghai value via
 * Intl. We use the `en-CA` locale because it formats dates as
 * `YYYY-MM-DD`, which is exactly what `dateStr` needs.
 */
export function toShanghai(date: Date): ShanghaiNow {
  // en-CA gives us YYYY-MM-DD reliably across Node versions.
  const partsFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = partsFormatter.formatToParts(date);
  const map = new Map<string, string>();
  for (const p of parts) {
    if (p.type !== 'literal') map.set(p.type, p.value);
  }

  const year = Number.parseInt(map.get('year') ?? '0', 10);
  const month = Number.parseInt(map.get('month') ?? '0', 10);
  const day = Number.parseInt(map.get('day') ?? '0', 10);
  let hour = map.get('hour') ?? '00';
  const minute = map.get('minute') ?? '00';

  // Intl hour12:false on some Node versions emits '24' for midnight — coerce.
  if (hour === '24') hour = '00';

  const dateStr = `${year.toString().padStart(4, '0')}-${map.get('month')}-${map.get('day')}`;
  const HHMM = `${hour}:${minute}`;

  return { year, month, day, HHMM, dateStr };
}

/**
 * Given the Shanghai now (typically from `toShanghai(new Date())`),
 * return the date string of the coverage window — the **previous**
 * Shanghai calendar day as `'YYYY-MM-DD'`.
 *
 * Careful with month/year rollovers; we use a UTC anchor to avoid
 * host-TZ drift when subtracting one day. Anchoring at Shanghai noon
 * (12:00Z +8 = 04:00 UTC) would work, but we use 00:00 UTC of the
 * same-numbered date — this is always unambiguous because we only
 * care about date arithmetic, not time-of-day.
 */
export function computeCoverageDate(nowInShanghai: { year: number; month: number; day: number }): string {
  // Build a UTC Date anchored at the Shanghai calendar date's midnight
  // (conceptually, not actually a Shanghai-midnight instant — just a
  // portable container for doing "-1 day" arithmetic).
  const anchor = new Date(
    Date.UTC(nowInShanghai.year, nowInShanghai.month - 1, nowInShanghai.day)
  );
  anchor.setUTCDate(anchor.getUTCDate() - 1);

  const y = anchor.getUTCFullYear().toString().padStart(4, '0');
  const m = (anchor.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = anchor.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Given a coverage date (`'YYYY-MM-DD'`), return the matching Asia/Shanghai
 * ISO-8601 timestamps for the window's start and end.
 *
 *   start = `YYYY-MM-DDT00:00:00+08:00`
 *   end   = `YYYY-MM-DDT23:59:59+08:00`
 *
 * Duration is exactly 24 hours minus 1 second — consistent with the PBT
 * P1 invariant in requirements.md.
 */
export function computeCoverageWindowIso(coverageDate: string): { startIso: string; endIso: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(coverageDate)) {
    throw new Error(`computeCoverageWindowIso: invalid coverageDate format: ${coverageDate}`);
  }
  return {
    startIso: `${coverageDate}T00:00:00+08:00`,
    endIso: `${coverageDate}T23:59:59+08:00`,
  };
}

/**
 * Decide whether the daily-alert tick should fire for a given config row,
 * evaluated against the Shanghai wall-clock "now".
 *
 * Fires if and only if:
 *   1. config.enabled === true
 *   2. nowInShanghai.HHMM === config.time_of_day (to-the-minute match)
 *
 * Timezone on the `config.timezone` column is CHECK-constrained to
 * `'Asia/Shanghai'` in V1 (see migration 015), so we do not re-check it.
 */
export function shouldFire(config: DailyAlertConfigRow, nowInShanghai: ShanghaiNow): boolean {
  return config.enabled === true && nowInShanghai.HHMM === config.time_of_day;
}
