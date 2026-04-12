import { NextRequest, NextResponse } from 'next/server';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const SYSTEM_PROMPT = `You are a report formatting assistant. Parse raw report text into a JSON structure called ReportContent.

Return ONLY valid JSON with this exact structure:
{
  "title": "report title",
  "dateRange": "date range, e.g. 2025-03-03 ~ 2025-03-16",
  "modules": [
    {
      "title": "module title",
      "subtitle": "optional subtitle",
      "tables": [
        {
          "headers": ["Col1", "Col2"],
          "rows": [
            { "cells": [{ "text": "value" }, { "text": "value", "badge": { "text": "High", "level": "high" } }] }
          ]
        }
      ],
      "analysisSections": [
        {
          "title": "section title",
          "quotes": [{ "text": "quote", "source": "source" }],
          "keyPoints": [{ "label": "label", "content": "detail", "impactTags": ["tag1"] }]
        }
      ],
      "highlightBoxes": [{ "title": "title", "content": "content" }]
    }
  ]
}

RULES:
1. Extract title and date range from text.
2. Group content into modules (each major section = one module).
3. Format tabular data into tables with headers and rows.
4. Badge levels: "high" for critical, "medium" for moderate, "low" for minor.
5. Extract quotes into quotes array, key findings into keyPoints.
6. Every module MUST have at least one table and one analysisSections entry.
7. Keep original language (Chinese stays Chinese, English stays English).
8. Return ONLY valid JSON. No markdown, no explanation, no code fences.`;

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

    const truncatedText = text.trim().length > 20000
      ? text.trim().slice(0, 20000) + '\n\n[Text truncated]'
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
          { role: 'user', content: `${typeHint}\n\nParse this report text into ReportContent JSON:\n\n---\n${truncatedText}\n---` },
        ],
        response_format: { type: 'json_object' },
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
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: 'No content returned from AI.' },
        { status: 502 }
      );
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
