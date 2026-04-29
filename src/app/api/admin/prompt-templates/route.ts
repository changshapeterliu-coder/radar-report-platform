import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdmin } from '../_utils/verify-admin';

/**
 * GET  /api/admin/prompt-templates?domain_id=<uuid>
 * POST /api/admin/prompt-templates
 *
 * Admin-only. GET returns the 3 prompt templates for a domain keyed by prompt_type
 * for easy client consumption. POST upserts a single template.
 */

const VALID_PROMPT_TYPES = [
  'engine_a_hot_radar',
  'engine_b_hot_radar',
  'shared_deep_dive',
  'synthesizer_prompt',
] as const;
type PromptType = (typeof VALID_PROMPT_TYPES)[number];

interface PromptTemplateRow {
  prompt_type: PromptType;
  template_text: string;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const admin = await verifyAdmin(supabase);
  if (!admin) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 },
      { status: 403 }
    );
  }

  const domainId = request.nextUrl.searchParams.get('domain_id');
  if (!domainId) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'domain_id query param is required', statusCode: 400 },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from('prompt_templates')
    .select('*')
    .eq('domain_id', domainId);

  if (error) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: error.message, statusCode: 500 },
      { status: 500 }
    );
  }

  const shaped: Record<PromptType, string | null> = {
    engine_a_hot_radar: null,
    engine_b_hot_radar: null,
    shared_deep_dive: null,
    synthesizer_prompt: null,
  };
  for (const row of (data ?? []) as PromptTemplateRow[]) {
    if (VALID_PROMPT_TYPES.includes(row.prompt_type)) {
      shaped[row.prompt_type] = row.template_text;
    }
  }

  return NextResponse.json({ data: shaped });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const admin = await verifyAdmin(supabase);
  if (!admin) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: 'INVALID_JSON', message: 'Invalid JSON body', statusCode: 400 },
      { status: 400 }
    );
  }

  const { domain_id, prompt_type, template_text } = body as {
    domain_id?: string;
    prompt_type?: string;
    template_text?: string;
  };

  if (!domain_id || typeof domain_id !== 'string') {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'domain_id is required', statusCode: 400 },
      { status: 400 }
    );
  }
  if (!prompt_type || !VALID_PROMPT_TYPES.includes(prompt_type as PromptType)) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: `prompt_type must be one of: ${VALID_PROMPT_TYPES.join(', ')}`,
        statusCode: 400,
      },
      { status: 400 }
    );
  }
  if (typeof template_text !== 'string' || template_text.trim() === '') {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'template_text is required', statusCode: 400 },
      { status: 400 }
    );
  }

  // Property 10 enforcement: synthesizer prompt must contain both engine output placeholders.
  if (prompt_type === 'synthesizer_prompt') {
    const hasGemini = template_text.includes('{gemini_output}');
    const hasKimi = template_text.includes('{kimi_output}');
    if (!hasGemini || !hasKimi) {
      return NextResponse.json(
        {
          code: 'VALIDATION_ERROR',
          message:
            'synthesizer_prompt must contain both {gemini_output} and {kimi_output} placeholders',
          statusCode: 400,
        },
        { status: 400 }
      );
    }
  }

  const { data, error } = await supabase
    .from('prompt_templates')
    .upsert(
      {
        domain_id,
        prompt_type: prompt_type as PromptType,
        template_text,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'domain_id,prompt_type' }
    )
    .select()
    .limit(1);

  if (error) {
    return NextResponse.json(
      { code: 'UPDATE_ERROR', message: error.message, statusCode: 500 },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: data?.[0] ?? null });
}
