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
            content: `You are a professional translator for Chinese-English bilingual reports about Amazon seller account health.

You receive a ReportContent JSON object. Translate ALL Chinese text in the following fields to ${langName}:

TEXT FIELDS TO TRANSLATE:
- top-level: title
- each module: title, subtitle, markdown
- each module.topTopics[]: topic, seller_discussion, keywords[] (translate each keyword)
- each module.topTools[]: tool_name, key_feedback_points[]
- each module.topEducationOpps[]: theme, target_audience, recommended_format[]
- (legacy) each module.blocks[]: text, quote, source, label, stats[].value, stats[].label, items[].title, items[].content, items[].meta
- (legacy) each module.tables[].headers[], each module.tables[].rows[].cells[].text, each .badge.text
- (legacy) each module.analysisSections[]: title, quotes[].text, quotes[].source, keyPoints[].label, keyPoints[].content, keyPoints[].impactTags[]
- (legacy) each module.highlightBoxes[]: title, content

FIELDS TO LEAVE UNCHANGED (they're enums / IDs / numbers):
- severity, urgency, sentiment (stay as "high" / "medium" / "low" / "negative" etc.)
- badge.level (stay as "high" / "medium" / "low")
- voice_volume (number, keep as-is)
- rank (string like "1 ✓")
- cross_engine_confirmed (boolean)
- type fields in blocks (stay as "heading" / "narrative" / etc.)
- dateRange (keep ISO dates)

SPECIAL RULE FOR MARKDOWN:
- Inside the markdown string, translate all prose but PRESERVE the Markdown syntax exactly:
  - Keep \`##\` / \`###\` heading markers
  - Keep \`> [!INSIGHT]\` / \`> [!WARNING]\` / \`> [!RECOMMENDATION]\` / \`> [!QUOTE]\` directive tags unchanged
  - Keep \`---\` separators
  - Keep table pipes \`|\` and alignment rows
  - Translate only the human-readable text inside blockquotes, paragraphs, list items, and table cells

Return ONLY the translated ReportContent JSON. Keep the EXACT same key names and structure — only translate text values. No markdown code fences in the output.`,
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
