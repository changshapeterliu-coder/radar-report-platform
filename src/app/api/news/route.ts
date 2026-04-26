import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

  const { searchParams } = request.nextUrl;
  const domainId = searchParams.get('domain_id');
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from('news')
    .select('*', { count: 'exact' });

  if (domainId) {
    query = query.eq('domain_id', domainId);
  }

  query = query
    .order('is_pinned', { ascending: false })
    .order('published_at', { ascending: false })
    .range(from, to);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: error.message, statusCode: 500 },
      { status: 500 }
    );
  }

  return NextResponse.json({
    data,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / limit),
    },
  });
}


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

  // Check admin role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
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

  const { title, content, source_channel, domain_id, summary } = body as {
    title?: string;
    content?: string;
    source_channel?: string;
    domain_id?: string;
    summary?: string;
  };

  // Validate required fields
  const missingFields: string[] = [];
  if (!title || typeof title !== 'string' || title.trim() === '') missingFields.push('title');
  if (!content || typeof content !== 'string' || content.trim() === '') missingFields.push('content');
  if (!source_channel || typeof source_channel !== 'string' || source_channel.trim() === '') missingFields.push('source_channel');
  if (!domain_id || typeof domain_id !== 'string') missingFields.push('domain_id');

  if (missingFields.length > 0) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: `Missing or invalid required fields: ${missingFields.join(', ')}`,
        statusCode: 400,
      },
      { status: 400 }
    );
  }

  const insertData: Record<string, unknown> = {
    title: title!,
    content: content!,
    source_channel: source_channel!,
    domain_id: domain_id!,
    created_by: user.id,
  };

  if (summary !== undefined) {
    insertData.summary = summary;
  }

  const { data, error } = await supabase
    .from('news')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { code: 'INSERT_ERROR', message: error.message, statusCode: 500 },
      { status: 500 }
    );
  }

  // Auto-translate news (non-blocking: don't fail the request if translation fails)
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (apiKey && data) {
      const originalText = JSON.stringify({ title: data.title, summary: data.summary, content: data.content });
      const isChinese = /[\u4e00-\u9fa5]/.test(originalText);
      const targetLang = isChinese ? 'English' : 'Chinese (Simplified)';

      const translateRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'openrouter/auto',
          messages: [
            {
              role: 'system',
              content: `You are a translator. Translate the JSON object's "title", "summary", and "content" fields to ${targetLang}. Keep structure identical. Return ONLY the JSON object, no markdown fences.`,
            },
            { role: 'user', content: originalText },
          ],
        }),
      });

      if (translateRes.ok) {
        const translateData = await translateRes.json();
        let translatedStr = translateData?.choices?.[0]?.message?.content;
        if (translatedStr) {
          translatedStr = translatedStr.trim();
          if (translatedStr.startsWith('```')) {
            translatedStr = translatedStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
          }
          try {
            const translated = JSON.parse(translatedStr);
            await supabase
              .from('news')
              .update({ content_translated: translated })
              .eq('id', data.id);
          } catch (e) {
            console.error('[News] Translation parse error:', e);
          }
        }
      }
    }
  } catch (e) {
    console.error('[News] Translation failed (non-blocking):', e);
  }

  return NextResponse.json({ data }, { status: 201 });
}
