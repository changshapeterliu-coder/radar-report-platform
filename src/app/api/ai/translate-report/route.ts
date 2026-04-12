import { NextRequest, NextResponse } from 'next/server';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

export async function POST(request: NextRequest) {
  try {
    if (!OPENROUTER_API_KEY) {
      return NextResponse.json({ error: 'API key not configured.' }, { status: 500 });
    }

    const { content, targetLang } = await request.json();

    if (!content || !targetLang) {
      return NextResponse.json({ error: 'Missing content or targetLang.' }, { status: 400 });
    }

    const langName = targetLang === 'zh' ? 'Chinese (Simplified)' : 'English';

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        messages: [
          {
            role: 'system',
            content: `You are a professional translator. Translate the given JSON report content to ${langName}. Keep the exact same JSON structure — only translate the text values (titles, content, quotes, labels, etc). Do NOT translate JSON keys. Return ONLY valid JSON, no markdown.`,
          },
          {
            role: 'user',
            content: `Translate this report content JSON to ${langName}:\n\n${JSON.stringify(content)}`,
          },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `AI API returned status ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const translated = JSON.parse(data?.choices?.[0]?.message?.content || '{}');

    if (!translated.title || !Array.isArray(translated.modules)) {
      return NextResponse.json({ error: 'Translation returned invalid structure.' }, { status: 422 });
    }

    return NextResponse.json(translated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
