import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdmin } from '../../../_utils/verify-admin';
import { inngest } from '@/lib/inngest/client';

/**
 * POST /api/admin/alerts/[topic_id]/re-translate-topic
 *
 * Admin-only. Clears the _en fields on a daily_hot_topics row and enqueues an
 * async translation job. The Inngest function reads the topic, translates the
 * Chinese primary + summary, and writes the English values back.
 *
 * Spec: .kiro/specs/daily-hot-topic-alert/ — Requirement 11, design §API 路由 §8
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ topic_id: string }> }
) {
  const { topic_id: topicId } = await context.params;

  if (!UUID_REGEX.test(topicId)) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'topic_id must be a UUID', statusCode: 400 },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const admin = await verifyAdmin(supabase);
  if (!admin) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 },
      { status: 403 }
    );
  }

  const { data: topicRows, error: fetchError } = await supabase
    .from('daily_hot_topics')
    .select('id, domain_id')
    .eq('id', topicId)
    .limit(1);
  if (fetchError) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: fetchError.message, statusCode: 500 },
      { status: 500 }
    );
  }
  const topic = topicRows?.[0];
  if (!topic) {
    return NextResponse.json(
      { code: 'NOT_FOUND', message: 'Topic not found', statusCode: 404 },
      { status: 404 }
    );
  }

  const { error: updateError } = await supabase
    .from('daily_hot_topics')
    .update({ topic_name_en: null, summary_en: null })
    .eq('id', topicId);
  if (updateError) {
    return NextResponse.json(
      { code: 'UPDATE_ERROR', message: updateError.message, statusCode: 500 },
      { status: 500 }
    );
  }

  await inngest.send({
    name: 'daily-alert/translate-topic',
    data: { topicId, domainId: topic.domain_id as string },
  });

  return NextResponse.json({ data: { queued: true } }, { status: 202 });
}
