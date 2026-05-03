import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  computeCoverageDate,
  toShanghai,
} from '@/lib/daily-alert/coverage-window';
import type { AlertsOverviewResponse } from '@/types/daily-alert';

/**
 * GET /api/alerts?window_end_date=YYYY-MM-DD
 *
 * Authenticated (any user, admin + team_member). Returns the daily hot-topic
 * alert overview for a 7-day window anchored at `window_end_date` (default =
 * yesterday in Asia/Shanghai, i.e. the latest completed coverage date).
 *
 * Response shape matches AlertsOverviewResponse in `src/types/daily-alert.ts`.
 * For each day in the window, one row is returned — including "no-run" entries
 * for dates with no daily_alert_runs row. Rows are in reverse chronological
 * order (newest first).
 *
 * For published alerts we include the top 3 topics (by rank asc) as a preview.
 *
 * Spec: .kiro/specs/daily-hot-topic-alert/ — Requirement 8, design §API 路由 §6
 */

const DEFAULT_DOMAIN_NAME = 'Account Health';
const WINDOW_DAYS = 7;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Shift a YYYY-MM-DD string by `deltaDays` (positive or negative). */
function shiftDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map((s) => Number.parseInt(s, 10));
  const anchor = new Date(Date.UTC(y, m - 1, d));
  anchor.setUTCDate(anchor.getUTCDate() + deltaDays);
  const yy = anchor.getUTCFullYear().toString().padStart(4, '0');
  const mm = (anchor.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = anchor.getUTCDate().toString().padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Return the Sun..Sat short weekday for a YYYY-MM-DD string, computed in UTC. */
function weekdayShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map((s) => Number.parseInt(s, 10));
  const dayIdx = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return WEEKDAY_SHORT[dayIdx];
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      { status: 401 }
    );
  }

  // Resolve end date.
  const endParam = request.nextUrl.searchParams.get('window_end_date');
  let endDate: string;
  if (endParam) {
    if (!DATE_REGEX.test(endParam)) {
      return NextResponse.json(
        {
          code: 'VALIDATION_ERROR',
          message: 'window_end_date must match YYYY-MM-DD',
          statusCode: 400,
        },
        { status: 400 }
      );
    }
    endDate = endParam;
  } else {
    endDate = computeCoverageDate(toShanghai(new Date()));
  }
  const startDate = shiftDate(endDate, -(WINDOW_DAYS - 1));

  // Resolve Account Health domain_id.
  const { data: domainRows, error: domainError } = await supabase
    .from('domains')
    .select('id')
    .eq('name', DEFAULT_DOMAIN_NAME)
    .limit(1);
  if (domainError) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: domainError.message, statusCode: 500 },
      { status: 500 }
    );
  }
  const domainId = domainRows?.[0]?.id;
  if (!domainId) {
    return NextResponse.json(
      {
        code: 'NOT_FOUND',
        message: `Default domain "${DEFAULT_DOMAIN_NAME}" not found`,
        statusCode: 404,
      },
      { status: 404 }
    );
  }

  // Fetch alerts + runs in the window.
  const { data: alertRows, error: alertsError } = await supabase
    .from('daily_hot_topic_alerts')
    .select('id, coverage_window_start_date, status, published_at')
    .eq('domain_id', domainId)
    .gte('coverage_window_start_date', startDate)
    .lte('coverage_window_start_date', endDate);
  if (alertsError) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: alertsError.message, statusCode: 500 },
      { status: 500 }
    );
  }

  const { data: runRows, error: runsError } = await supabase
    .from('daily_alert_runs')
    .select('coverage_window_start_date, status')
    .eq('domain_id', domainId)
    .gte('coverage_window_start_date', startDate)
    .lte('coverage_window_start_date', endDate);
  if (runsError) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: runsError.message, statusCode: 500 },
      { status: 500 }
    );
  }

  // Fetch top-3 topics per alert (one query, then group in memory).
  const alertIds = (alertRows ?? []).map((a) => a.id as string);
  const topicsByAlertId = new Map<
    string,
    Array<{ topic_name_zh: string; topic_name_en: string | null; is_new_canonical: boolean; rank: number }>
  >();
  if (alertIds.length > 0) {
    const { data: topicRows, error: topicsError } = await supabase
      .from('daily_hot_topics')
      .select('alert_id, rank, topic_name_zh, topic_name_en, is_new_canonical')
      .in('alert_id', alertIds)
      .order('rank', { ascending: true });
    if (topicsError) {
      return NextResponse.json(
        { code: 'QUERY_ERROR', message: topicsError.message, statusCode: 500 },
        { status: 500 }
      );
    }
    for (const t of topicRows ?? []) {
      const arr = topicsByAlertId.get(t.alert_id as string) ?? [];
      if (arr.length < 3) {
        arr.push({
          topic_name_zh: t.topic_name_zh as string,
          topic_name_en: (t.topic_name_en as string | null) ?? null,
          is_new_canonical: t.is_new_canonical as boolean,
          rank: t.rank as number,
        });
      }
      topicsByAlertId.set(t.alert_id as string, arr);
    }
  }

  // Index alerts + runs by date for O(1) lookup in the loop below.
  const alertByDate = new Map<string, { id: string; status: string }>();
  for (const a of alertRows ?? []) {
    alertByDate.set(a.coverage_window_start_date as string, {
      id: a.id as string,
      status: a.status as string,
    });
  }
  const runStatusByDate = new Map<string, string>();
  for (const r of runRows ?? []) {
    const existing = runStatusByDate.get(r.coverage_window_start_date as string);
    // If multiple runs exist for one date (retry scenario), prefer succeeded > failed.
    const incoming = r.status as string;
    if (!existing) {
      runStatusByDate.set(r.coverage_window_start_date as string, incoming);
    } else if (existing !== 'succeeded' && incoming === 'succeeded') {
      runStatusByDate.set(r.coverage_window_start_date as string, incoming);
    }
  }

  // Build overview rows in reverse chronological order.
  const overview: AlertsOverviewResponse['overview'] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const date = shiftDate(startDate, i);
    const alert = alertByDate.get(date);
    const runStatus = runStatusByDate.get(date);

    if (alert) {
      const previewTopics = (topicsByAlertId.get(alert.id) ?? [])
        .slice(0, 3)
        .map((t) => ({
          topic_name_zh: t.topic_name_zh,
          topic_name_en: t.topic_name_en,
          is_new_canonical: t.is_new_canonical,
        }));
      overview.push({
        date,
        weekday: weekdayShort(date),
        status: 'published',
        topic_count: previewTopics.length === 0 ? 0 : (topicsByAlertId.get(alert.id)?.length ?? 0),
        top_topic_preview: previewTopics,
      });
    } else if (runStatus === 'failed') {
      overview.push({
        date,
        weekday: weekdayShort(date),
        status: 'failed',
        topic_count: null,
        top_topic_preview: [],
      });
    } else {
      overview.push({
        date,
        weekday: weekdayShort(date),
        status: 'no-run',
        topic_count: null,
        top_topic_preview: [],
      });
    }
  }

  // For published alerts we need the full topic_count (not just the preview count).
  // Run a second pass to fix up topic_count from a count-only query.
  if (alertIds.length > 0) {
    const { data: countRows, error: countsError } = await supabase
      .from('daily_hot_topics')
      .select('alert_id')
      .in('alert_id', alertIds);
    if (countsError) {
      return NextResponse.json(
        { code: 'QUERY_ERROR', message: countsError.message, statusCode: 500 },
        { status: 500 }
      );
    }
    const countByAlertId = new Map<string, number>();
    for (const row of countRows ?? []) {
      const k = row.alert_id as string;
      countByAlertId.set(k, (countByAlertId.get(k) ?? 0) + 1);
    }
    for (const row of overview) {
      if (row.status === 'published') {
        const alert = alertByDate.get(row.date);
        if (alert) row.topic_count = countByAlertId.get(alert.id) ?? 0;
      }
    }
  }

  const response: AlertsOverviewResponse = {
    window: { startDate, endDate },
    overview,
  };

  return NextResponse.json({ data: response });
}
