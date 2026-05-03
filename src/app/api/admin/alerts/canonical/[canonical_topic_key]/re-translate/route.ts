import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdmin } from '../../../../_utils/verify-admin';
import { inngest } from '@/lib/inngest/client';

/**
 * POST /api/admin/alerts/canonical/[canonical_topic_key]/re-translate
 *
 * Admin-only. Clears the _en fields on a topic_canonicals row (keyed by
 * Account Health domain + canonical_topic_key) and enqueues an async
 * translation job. UI URL-encodes "::" as "%3A%3A"; we decodeURIComponent
 * the path param before lookup.
 *
 * Spec: .kiro/specs/daily-hot-topic-alert/ — Requirement 11, design §API 路由 §9
 */

const DEFAULT_DOMAIN_NAME = 'Account Health';

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ canonical_topic_key: string }> }
) {
  const { canonical_topic_key: rawKey } = await context.params;

  let canonicalTopicKey: string;
  try {
    canonicalTopicKey = decodeURIComponent(rawKey);
  } catch {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: 'canonical_topic_key is not valid URL-encoded text',
        statusCode: 400,
      },
      { status: 400 }
    );
  }

  if (!canonicalTopicKey || canonicalTopicKey.length === 0) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: 'canonical_topic_key is required',
        statusCode: 400,
      },
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

  const { data: canonicalRows, error: canonicalError } = await supabase
    .from('topic_canonicals')
    .select('canonical_topic_key')
    .eq('domain_id', domainId)
    .eq('canonical_topic_key', canonicalTopicKey)
    .limit(1);
  if (canonicalError) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: canonicalError.message, statusCode: 500 },
      { status: 500 }
    );
  }
  if (!canonicalRows || canonicalRows.length === 0) {
    return NextResponse.json(
      { code: 'NOT_FOUND', message: 'Canonical not found', statusCode: 404 },
      { status: 404 }
    );
  }

  const { error: updateError } = await supabase
    .from('topic_canonicals')
    .update({ canonical_title_en: null, canonical_description_en: null })
    .eq('domain_id', domainId)
    .eq('canonical_topic_key', canonicalTopicKey);
  if (updateError) {
    return NextResponse.json(
      { code: 'UPDATE_ERROR', message: updateError.message, statusCode: 500 },
      { status: 500 }
    );
  }

  await inngest.send({
    name: 'daily-alert/translate-canonical',
    data: { domainId, canonicalTopicKey },
  });

  return NextResponse.json({ data: { queued: true } }, { status: 202 });
}
