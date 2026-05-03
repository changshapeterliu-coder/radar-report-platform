import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type {
  DailyHotTopicFull,
  DayDetailResponse,
} from '@/types/daily-alert';

/**
 * GET /api/alerts/by-date/[date]
 *
 * Authenticated (any user). Returns the daily hot-topic alert for a specific
 * coverage date (YYYY-MM-DD). Response shape matches DayDetailResponse:
 *
 *   - { kind: 'no-run' }                → no alert, or the only run failed
 *   - { kind: 'empty-day', alert }      → published alert with zero topics
 *   - { kind: 'published', alert, topics } → published alert with topics + canonical join
 *
 * Spec: .kiro/specs/daily-hot-topic-alert/ — Requirement 8, design §API 路由 §7
 */

const DEFAULT_DOMAIN_NAME = 'Account Health';
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ date: string }> }
) {
  const { date } = await context.params;

  if (!DATE_REGEX.test(date)) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: 'date must match YYYY-MM-DD',
        statusCode: 400,
      },
      { status: 400 }
    );
  }

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

  const { data: alertRows, error: alertError } = await supabase
    .from('daily_hot_topic_alerts')
    .select(
      'id, published_at, coverage_window_start_date, empty_day_message_zh, empty_day_message_en'
    )
    .eq('domain_id', domainId)
    .eq('coverage_window_start_date', date)
    .limit(1);
  if (alertError) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: alertError.message, statusCode: 500 },
      { status: 500 }
    );
  }

  const alert = alertRows?.[0];
  if (!alert) {
    // No alert for this date — could be "no run" or "failed-only run"; the
    // detail pane treats both the same (admins see failed runs in the runs list).
    const response: DayDetailResponse = { kind: 'no-run' };
    return NextResponse.json({ data: response });
  }

  // Fetch topics for this alert.
  const { data: topicRows, error: topicsError } = await supabase
    .from('daily_hot_topics')
    .select('*')
    .eq('alert_id', alert.id)
    .order('rank', { ascending: true });
  if (topicsError) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: topicsError.message, statusCode: 500 },
      { status: 500 }
    );
  }

  if (!topicRows || topicRows.length === 0) {
    const response: DayDetailResponse = {
      kind: 'empty-day',
      alert: {
        id: alert.id as string,
        published_at: alert.published_at as string,
        empty_day_message_zh: (alert.empty_day_message_zh as string | null) ?? null,
        empty_day_message_en: (alert.empty_day_message_en as string | null) ?? null,
      },
    };
    return NextResponse.json({ data: response });
  }

  // Fetch canonical rows keyed by canonical_topic_key for the referenced set.
  const canonicalKeys = Array.from(
    new Set(topicRows.map((t) => t.canonical_topic_key as string))
  );
  const { data: canonicalRows, error: canonicalError } = await supabase
    .from('topic_canonicals')
    .select(
      'canonical_topic_key, canonical_title_zh, canonical_title_en, canonical_description_zh, canonical_description_en, secondary_axis_type, secondary_axis_value'
    )
    .eq('domain_id', domainId)
    .in('canonical_topic_key', canonicalKeys);
  if (canonicalError) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: canonicalError.message, statusCode: 500 },
      { status: 500 }
    );
  }

  const canonicalByKey = new Map<
    string,
    {
      canonical_topic_key: string;
      canonical_title_zh: string;
      canonical_title_en: string | null;
      canonical_description_zh: string;
      canonical_description_en: string | null;
      secondary_axis_type: 'site' | 'category' | null;
      secondary_axis_value: string | null;
    }
  >();
  for (const c of canonicalRows ?? []) {
    canonicalByKey.set(c.canonical_topic_key as string, {
      canonical_topic_key: c.canonical_topic_key as string,
      canonical_title_zh: c.canonical_title_zh as string,
      canonical_title_en: (c.canonical_title_en as string | null) ?? null,
      canonical_description_zh: c.canonical_description_zh as string,
      canonical_description_en: (c.canonical_description_en as string | null) ?? null,
      secondary_axis_type: (c.secondary_axis_type as 'site' | 'category' | null) ?? null,
      secondary_axis_value: (c.secondary_axis_value as string | null) ?? null,
    });
  }

  const topics: DailyHotTopicFull[] = topicRows.map((row) => {
    const canonical = canonicalByKey.get(row.canonical_topic_key as string) ?? {
      canonical_topic_key: row.canonical_topic_key as string,
      canonical_title_zh: '',
      canonical_title_en: null,
      canonical_description_zh: '',
      canonical_description_en: null,
      secondary_axis_type: null,
      secondary_axis_value: null,
    };
    return {
      id: row.id as string,
      alert_id: row.alert_id as string,
      domain_id: row.domain_id as string,
      topic_name_zh: row.topic_name_zh as string,
      topic_name_en: (row.topic_name_en as string | null) ?? null,
      keywords: (row.keywords as string[]) ?? [],
      sample_quotes: (row.sample_quotes as Array<{ text: string; source_label: string }>) ?? [],
      source_links:
        (row.source_links as Array<{
          title: string;
          url: string;
          source_label: string;
          published_date: string | null;
        }>) ?? [],
      hot_score: row.hot_score as number,
      summary_zh: row.summary_zh as string,
      summary_en: (row.summary_en as string | null) ?? null,
      rank: row.rank as number,
      canonical_topic_key: row.canonical_topic_key as string,
      is_new_canonical: row.is_new_canonical as boolean,
      created_at: row.created_at as string,
      canonical,
    };
  });

  const response: DayDetailResponse = {
    kind: 'published',
    alert: {
      id: alert.id as string,
      published_at: alert.published_at as string,
      coverage_window_start_date: alert.coverage_window_start_date as string,
    },
    topics,
  };
  return NextResponse.json({ data: response });
}
