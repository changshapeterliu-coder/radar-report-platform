import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;

const SYSTEM_PROMPT = `You are a report formatting assistant. Your job is to parse raw report text (which may be in Chinese or English) and structure it into a specific JSON format called ReportContent.

The JSON structure you MUST return is:

{
  "title": "string - the report title extracted from the text",
  "dateRange": "string - the date range of the report, e.g. '2025-01-01 ~ 2025-01-15'",
  "modules": [
    {
      "title": "string - module/section title",
      "subtitle": "string (optional) - module subtitle",
      "tables": [
        {
          "headers": ["string", "string"],
          "rows": [
            {
              "cells": [
                {
                  "text": "string - cell content",
                  "badge": {
                    "text": "string - badge label (optional)",
                    "level": "high | medium | low"
                  }
                }
              ]
            }
          ]
        }
      ],
      "analysisSections": [
        {
          "title": "string - analysis section title",
          "quotes": [
            { "text": "string - quote text", "source": "string - quote source" }
          ],
          "keyPoints": [
            {
              "label": "string - short label",
              "content": "string - detailed content",
              "impactTags": ["string - tag1", "string - tag2"]
            }
          ]
        }
      ],
      "highlightBoxes": [
        { "title": "string - highlight title", "content": "string - highlight content" }
      ]
    }
  ]
}

RULES:
1. Extract the report title and date range from the text. If not found, use reasonable defaults.
2. Group related content into modules. Each major section/topic should be its own module.
3. If the text contains tabular data, format it into the tables array with appropriate headers and rows.
4. Use badge levels: "high" for critical/severe items, "medium" for moderate items, "low" for minor items.
5. Extract notable quotes or seller feedback into the quotes array.
6. Summarize key findings into keyPoints with appropriate impactTags.
7. Use highlightBoxes for important callouts, warnings, or summary boxes.
8. Every module MUST have at least one table (even if minimal) and one analysisSections entry.
9. If the text is in Chinese, keep the content in Chinese. If in English, keep in English.
10. Return ONLY valid JSON matching the structure above. No markdown, no explanation.

EXAMPLE OUTPUT:
{
  "title": "Account Health Radar Report",
  "dateRange": "2025-03-03 ~ 2025-03-16",
  "modules": [
    {
      "title": "Policy Violation Overview",
      "subtitle": "Key metrics and trends",
      "tables": [
        {
          "headers": ["Violation Type", "Count", "Severity"],
          "rows": [
            { "cells": [{ "text": "IP Complaint" }, { "text": "45" }, { "text": "High", "badge": { "text": "High", "level": "high" } }] },
            { "cells": [{ "text": "Product Authenticity" }, { "text": "23" }, { "text": "Medium", "badge": { "text": "Medium", "level": "medium" } }] }
          ]
        }
      ],
      "analysisSections": [
        {
          "title": "Trend Analysis",
          "quotes": [
            { "text": "IP complaints increased 20% this period", "source": "Internal Data" }
          ],
          "keyPoints": [
            {
              "label": "Rising Trend",
              "content": "IP-related violations show a consistent upward trend over the past 3 reporting periods.",
              "impactTags": ["IP", "Compliance", "High Priority"]
            }
          ]
        }
      ],
      "highlightBoxes": [
        { "title": "Action Required", "content": "Review all pending IP complaints before next audit cycle." }
      ]
    }
  ]
}`;

export async function POST(request: NextRequest) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY is not configured on the server.' },
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

    // Truncate very long text to avoid token limits (keep first 15000 chars)
    const truncatedText = text.trim().length > 15000 ? text.trim().slice(0, 15000) + '\n\n[Text truncated for processing]' : text.trim();
        { error: 'Missing or empty "text" field.' },
        { status: 400 }
      );
    }

    const reportTypeHint = reportType === 'topic'
      ? 'This is a TOPIC/SPECIFIC report focusing on a single subject in depth.'
      : 'This is a REGULAR periodic report covering multiple topics.';

    const userPrompt = `${reportTypeHint}\n\nPlease parse the following raw report text into the ReportContent JSON structure:\n\n---\n${truncatedText}\n---`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_API_KEY}`;

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { parts: [{ text: SYSTEM_PROMPT + '\n\n' + userPrompt }] },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', geminiRes.status, errText);
      return NextResponse.json(
        { error: `Gemini API returned status ${geminiRes.status}` },
        { status: 502 }
      );
    }

    const geminiData = await geminiRes.json();

    const candidate = geminiData?.candidates?.[0];
    const rawJson = candidate?.content?.parts?.[0]?.text;

    if (!rawJson) {
      return NextResponse.json(
        { error: 'No content returned from Gemini API.' },
        { status: 502 }
      );
    }

    const parsed = JSON.parse(rawJson);

    // Basic validation
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
