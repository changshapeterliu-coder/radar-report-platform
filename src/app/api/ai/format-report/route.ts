import { NextRequest, NextResponse } from 'next/server';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const SYSTEM_PROMPT = `You are a report formatting assistant. Parse raw report text into a JSON structure called ReportContent (v4 Markdown-hybrid format). Your job is classification & light restructuring — NOT rewriting.

Return ONLY valid JSON with this exact structure:
{
  "title": "report title",
  "dateRange": "standardized date range",
  "modules": [
    {
      "title": "module title",
      "topTopics": [],
      "markdown": "the module body as Markdown"
    }
  ]
}

CRITICAL RULES:

1. **Do NOT rewrite, summarize, paraphrase, or shorten any content.** Keep original wording verbatim. Your job is to classify & structure, not to edit.

2. **Preserve all information.** Nothing from the source text should be lost. If unsure where a piece fits, put it in the module's markdown field.

3. **Module boundaries** — Split the source text by natural section breaks (e.g. headings like "一、xxx", "二、xxx" or "Module 1/2/3", or large empty-line paragraph breaks). Each section becomes one module. If the source has no clear section structure, put everything in a single module titled "Summary".

4. **Markdown formatting inside each module.markdown**:
   - Preserve headings (use "##" for section, "###" for sub-section)
   - Preserve lists (use "-" for bullets, "1." for numbered)
   - Preserve bold / italic if source has them
   - For quotes: use custom callout \`> [!QUOTE]\` followed by the verbatim text, then \`— author · source · date\` on a new line
   - For key insights or takeaways: \`> [!INSIGHT]\` followed by the content
   - For warnings or risks: \`> [!WARNING]\` followed by the content
   - For action items / recommendations: \`> [!RECOMMENDATION]\` followed by the content
   - For tabular data: use GitHub Markdown tables (| Col | Col |)
   - Keep raw numeric data inline (don't structure it into topTopics)

5. **topTopics stays EMPTY** for Smart Paste — manual pastes don't go through the topic-extraction pipeline. The array must be present but empty: \`"topTopics": []\`

6. **Time range standardization** — Edit the dateRange field to match one of these formats:
   - If source has full dates: "YYYY-MM-DD ~ YYYY-MM-DD"
   - If source has only month: "YYYY-MM ~ YYYY-MM"
   - If source has only quarter: "YYYY Qx ~ YYYY Qx"
   - Normalize 中文日期 / slash-dates / natural language into standard format
   - This is the ONLY edit you make to content — everything else stays verbatim

7. **Keep original language** — Chinese stays Chinese, English stays English. Do not translate.

8. Return ONLY valid JSON. No markdown fences, no explanation.`;

export async function POST(request: NextRequest) {
  try {
    if (!OPENROUTER_API_KEY) {
      return NextResponse.json(
        { error: 'OPENROUTER_API_KEY is not configured on the server.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { text, reportType } = body as { text?: string; reportType?: string };

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Missing or empty "text" field.' },
        { status: 400 }
      );
    }

    const truncatedText = text.trim().length > 50000
      ? text.trim().slice(0, 50000) + '\n\n[Text truncated]'
      : text.trim();

    const typeHint = reportType === 'topic'
      ? 'This is a TOPIC report focusing on a single subject.'
      : 'This is a REGULAR periodic report with multiple modules.';

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `${typeHint}\n\nParse this report text into ReportContent JSON. Classify content into blocks, keep all original wording verbatim, standardize only the dateRange field. Return ONLY the JSON object:\n\n---\n${truncatedText}\n---` },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('OpenRouter error:', res.status, errText);
      return NextResponse.json(
        { error: `AI API returned status ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    let content = data?.choices?.[0]?.message?.content;

    if (!content) {
      console.error('OpenRouter empty response:', JSON.stringify(data));
      return NextResponse.json(
        { error: 'No content returned from AI.' },
        { status: 502 }
      );
    }

    // Strip markdown code fences if present
    content = content.trim();
    if (content.startsWith('```')) {
      content = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(content);

    if (!parsed.title || !Array.isArray(parsed.modules)) {
      return NextResponse.json(
        { error: 'AI returned invalid ReportContent structure.' },
        { status: 422 }
      );
    }

    return NextResponse.json(parsed);
  } catch (err: unknown) {
    console.error('format-report error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
