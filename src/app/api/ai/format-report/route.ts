import { NextRequest, NextResponse } from 'next/server';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const SYSTEM_PROMPT = `You are a report formatting assistant. Parse raw report text into a JSON structure called ReportContent. Your job is classification & light restructuring — NOT rewriting.

Return ONLY valid JSON with this exact structure:
{
  "title": "report title",
  "dateRange": "standardized date range",
  "modules": [
    {
      "title": "module title",
      "subtitle": "optional",
      "blocks": [
        { "type": "heading", "text": "subsection heading" },
        { "type": "narrative", "text": "a prose paragraph, verbatim from source" },
        { "type": "insight", "label": "Key Insight", "text": "a key takeaway or synthesis" },
        { "type": "quote", "quote": "verbatim seller voice", "source": "channel · author · date" },
        { "type": "stat", "stats": [{ "value": "5.2", "label": "avg calls per case" }, { "value": "¥500-3K", "label": "service price" }] },
        { "type": "warning", "label": "Policy Conflict", "text": "warning content" },
        { "type": "recommendation", "label": "For AHS", "text": "actionable recommendation" },
        { "type": "list", "items": [{ "title": "optional bold lead", "content": "main text", "meta": "optional metadata like volume score" }] }
      ],
      "tables": [{"headers": ["Col1","Col2"], "rows": [{"cells": [{"text":"v"},{"text":"v","badge":{"text":"High","level":"high"}}]}]}],
      "analysisSections": [],
      "highlightBoxes": []
    }
  ]
}

CRITICAL RULES:

1. **Do NOT rewrite, summarize, paraphrase, or shorten any content.** Keep original wording verbatim. Your job is to classify & structure, not to edit.

2. **Preserve all information.** Nothing from the source text should be lost. If unsure where a piece fits, put it in "narrative".

3. **Block type classification**:
   - heading: subsection titles (e.g., "2.1 KOL 话术 Top 5")
   - narrative: prose paragraphs, intros, backgrounds, transitions
   - insight: key takeaways, synthesis statements, important conclusions
   - quote: direct speaker voice, seller verbatim (must have quote + source)
   - stat: numeric data points — GROUP related stats into a single "stat" block with multiple items in "stats" array
   - warning: risks, policy conflicts, red flags
   - recommendation: action items, suggestions, next steps
   - list: ordered or unordered lists of related items (e.g., top 5 findings)

4. **Time range standardization** — Edit the dateRange field to match one of these formats:
   - If source has full dates: "YYYY-MM-DD ~ YYYY-MM-DD" (e.g., "2025-10-01 ~ 2026-04-15")
   - If source has only month: "YYYY-MM ~ YYYY-MM" (e.g., "2025-10 ~ 2026-04")
   - If source has only quarter: "YYYY Q3 ~ YYYY Q4"
   - Normalize 中文日期 / slash-dates / natural language into standard format
   - This is the ONLY edit you make to content — everything else stays verbatim

5. **Reorder blocks for better readability** — You may reorder blocks within a module to improve visual rhythm:
   - Start with a narrative intro if available
   - Put headings before related blocks
   - Group related stats together
   - Place insights near their supporting evidence
   - End with recommendations when relevant
   - Do NOT reorder across modules — only within a module
   - Do NOT create blocks that don't exist in source — only reorder what's there

6. **Tables, analysisSections, highlightBoxes**:
   - If source has tabular data, put in tables (not as list block)
   - analysisSections & highlightBoxes can remain empty if not naturally present
   - Do NOT force these structures — prefer blocks for most content

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
