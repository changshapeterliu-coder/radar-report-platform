import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { translateDailyPair } from '@/lib/daily-alert/translate';

/**
 * POST /api/ai/translate-daily
 *
 * Authenticated (any user). Thin HTTP adapter over `translateDailyPair()`.
 * Provided for symmetry with /api/ai/translate-report and for future UIs that
 * want synchronous zh→en translation without going through Inngest. The
 * production re-translate flow runs via Inngest functions and calls
 * translateDailyPair() directly (not this endpoint).
 *
 * Request body:
 *   { kind: 'topic' | 'canonical', zh_primary: string, zh_secondary: string }
 *
 * Response:
 *   200: { data: { en_primary, en_secondary } }
 *   502: upstream translation failure
 *
 * Spec: .kiro/specs/daily-hot-topic-alert/ — Requirement 10, design §API 路由 §11
 */

const VALID_KINDS = ['topic', 'canonical'] as const;
type Kind = (typeof VALID_KINDS)[number];

export async function POST(request: NextRequest) {
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: 'INVALID_JSON', message: 'Invalid JSON body', statusCode: 400 },
      { status: 400 }
    );
  }

  const { kind, zh_primary, zh_secondary } = body as {
    kind?: string;
    zh_primary?: string;
    zh_secondary?: string;
  };

  if (!kind || !VALID_KINDS.includes(kind as Kind)) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: `kind must be one of: ${VALID_KINDS.join(', ')}`,
        statusCode: 400,
      },
      { status: 400 }
    );
  }
  if (typeof zh_primary !== 'string' || zh_primary.trim().length === 0) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: 'zh_primary is required and must be a non-empty string',
        statusCode: 400,
      },
      { status: 400 }
    );
  }
  if (typeof zh_secondary !== 'string' || zh_secondary.trim().length === 0) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: 'zh_secondary is required and must be a non-empty string',
        statusCode: 400,
      },
      { status: 400 }
    );
  }

  try {
    const result = await translateDailyPair({
      kind: kind as Kind,
      zh_primary,
      zh_secondary,
    });
    return NextResponse.json({
      data: {
        en_primary: result.en_primary,
        en_secondary: result.en_secondary,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown translation error';
    return NextResponse.json(
      { code: 'UPSTREAM_ERROR', message, statusCode: 502 },
      { status: 502 }
    );
  }
}
