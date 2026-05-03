import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdmin } from '../../_utils/verify-admin';

/**
 * PUT /api/admin/daily-alert-prompts/[prompt_type]
 *
 * Admin-only. Upserts a single daily-alert prompt template for the Account
 * Health domain. Placeholder validation:
 *   - daily_scan_prompt must contain {coverage_window_start} AND {coverage_window_end}
 *   - daily_canonicalization_prompt must contain {scanned_topics_json} AND {existing_canonicals_json}
 *
 * Spec: .kiro/specs/daily-hot-topic-alert/ — Requirement 12, design §API 路由 §5
 */

const DEFAULT_DOMAIN_NAME = 'Account Health';
const MIN_TEMPLATE_LENGTH = 50;

type DailyPromptType = 'daily_scan_prompt' | 'daily_canonicalization_prompt';
const VALID_PROMPT_TYPES: readonly DailyPromptType[] = [
  'daily_scan_prompt',
  'daily_canonicalization_prompt',
] as const;

const REQUIRED_PLACEHOLDERS: Record<DailyPromptType, readonly string[]> = {
  daily_scan_prompt: ['{coverage_window_start}', '{coverage_window_end}'],
  daily_canonicalization_prompt: ['{scanned_topics_json}', '{existing_canonicals_json}'],
};

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ prompt_type: string }> }
) {
  const { prompt_type: rawPromptType } = await context.params;

  const supabase = await createClient();
  const admin = await verifyAdmin(supabase);
  if (!admin) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 },
      { status: 403 }
    );
  }

  if (!VALID_PROMPT_TYPES.includes(rawPromptType as DailyPromptType)) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: `prompt_type must be one of: ${VALID_PROMPT_TYPES.join(', ')}`,
        statusCode: 400,
      },
      { status: 400 }
    );
  }
  const promptType = rawPromptType as DailyPromptType;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: 'INVALID_JSON', message: 'Invalid JSON body', statusCode: 400 },
      { status: 400 }
    );
  }

  const { template_text } = body as { template_text?: string };
  if (typeof template_text !== 'string' || template_text.trim().length === 0) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'template_text is required', statusCode: 400 },
      { status: 400 }
    );
  }
  if (template_text.length < MIN_TEMPLATE_LENGTH) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: `template_text must be at least ${MIN_TEMPLATE_LENGTH} characters`,
        statusCode: 400,
      },
      { status: 400 }
    );
  }

  const required = REQUIRED_PLACEHOLDERS[promptType];
  const missing = required.filter((p) => !template_text.includes(p));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: `template_text is missing required placeholder(s): ${missing.join(', ')}`,
        statusCode: 400,
      },
      { status: 400 }
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

  const { error: upsertError } = await supabase
    .from('prompt_templates')
    .upsert(
      {
        domain_id: domainId,
        prompt_type: promptType,
        template_text,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'domain_id,prompt_type' }
    );

  if (upsertError) {
    return NextResponse.json(
      { code: 'UPDATE_ERROR', message: upsertError.message, statusCode: 500 },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { updated: true } });
}
