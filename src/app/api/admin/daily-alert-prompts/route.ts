import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdmin } from '../_utils/verify-admin';
import {
  DEFAULT_DAILY_SCAN_PROMPT,
  DEFAULT_DAILY_CANONICALIZATION_PROMPT,
} from '@/lib/daily-alert/prompt-defaults';

/**
 * GET /api/admin/daily-alert-prompts
 *
 * Admin-only. Returns the two daily-alert prompt templates (scan +
 * canonicalization) for the Account Health domain, alongside the hardcoded
 * defaults (for the UI "Reset to default" action).
 *
 * Spec: .kiro/specs/daily-hot-topic-alert/ — Requirement 12, design §API 路由 §5
 */

const DEFAULT_DOMAIN_NAME = 'Account Health';

type DailyPromptType = 'daily_scan_prompt' | 'daily_canonicalization_prompt';

export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const admin = await verifyAdmin(supabase);
  if (!admin) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 },
      { status: 403 }
    );
  }

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

  const { data: promptRows, error: promptError } = await supabase
    .from('prompt_templates')
    .select('prompt_type, template_text')
    .eq('domain_id', domainId)
    .in('prompt_type', ['daily_scan_prompt', 'daily_canonicalization_prompt']);

  if (promptError) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: promptError.message, statusCode: 500 },
      { status: 500 }
    );
  }

  const shaped: Record<DailyPromptType, string | null> = {
    daily_scan_prompt: null,
    daily_canonicalization_prompt: null,
  };
  for (const row of promptRows ?? []) {
    const t = row.prompt_type as DailyPromptType;
    if (t === 'daily_scan_prompt' || t === 'daily_canonicalization_prompt') {
      shaped[t] = row.template_text;
    }
  }

  return NextResponse.json({
    data: {
      daily_scan_prompt: shaped.daily_scan_prompt,
      daily_canonicalization_prompt: shaped.daily_canonicalization_prompt,
      defaults: {
        daily_scan_prompt: DEFAULT_DAILY_SCAN_PROMPT,
        daily_canonicalization_prompt: DEFAULT_DAILY_CANONICALIZATION_PROMPT,
      },
    },
  });
}
