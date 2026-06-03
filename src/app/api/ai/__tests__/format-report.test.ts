import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

import { ReportContentV4Schema } from '@/lib/validators/report-schema';

/**
 * Regression test — Smart Paste pre-feature contract held (Task 5.2).
 *
 * A paste whose modules carry no topic content must still parse as valid
 * ReportContent with `topTopics: []` for EVERY module — the exact behavior that
 * existed before Layer-2 extraction was added (R5.1). The two LLM layers are
 * both mocked so the test is deterministic and offline:
 *   - Layer 1 (markdown assembly): the route's direct OpenRouter `fetch` is
 *     stubbed to return a valid markdown envelope with two `## ` sections.
 *   - Layer 2 (`extractTopTopicsForModule`): mocked to return a genuine-empty
 *     result `{ topics: [], dropped: 0, failed: false }` for every module.
 *
 * It also asserts the `extraction` summary's internal consistency
 * (`total === Σ perModule.extracted`, R5.3).
 *
 * Spec: .kiro/specs/smart-paste-topic-extraction
 * Feature: smart-paste-topic-extraction, Task 5.2
 */

// ── Layer 2 mock — genuine-empty extraction for every in-scope module ────────
// Hoisted by vitest above the route import, so the route picks up this mock.
vi.mock('@/lib/smart-paste/extract-top-topics', () => ({
  extractTopTopicsForModule: vi
    .fn()
    .mockResolvedValue({ topics: [], dropped: 0, failed: false }),
}));

// ── Layer 1 helper — an OpenRouter-shaped chat-completion envelope ───────────
// The route reads `data.choices[0].message.content` as PLAIN MARKDOWN (no JSON),
// then splits it on `## ` headings into modules.
function markdownEnvelope(markdown: string): Response {
  const body = { choices: [{ message: { content: markdown } }] };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// A two-section paste with NO topic content (no table, no ranked prose) — the
// no-topic case this regression guards.
const NO_TOPIC_MARKDOWN = `TITLE: 账户健康周报
DATERANGE: 2026-01-01 ~ 2026-01-07

## 概述
本期为说明性文字，没有任何排名话题、表格或热度信号，仅描述背景情况。

## 流程更新
另一段纯说明文字，介绍申诉流程的一般信息，同样没有结构化话题内容。`;

describe('POST /api/ai/format-report — no-topic paste regression', () => {
  const fetchMock = vi.fn<(url: unknown, init?: unknown) => Promise<Response>>();

  beforeEach(() => {
    // Set the server-side guard's required key BEFORE the route module is
    // dynamically imported below.
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test-key');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    // Layer 1: every OpenRouter call returns the no-topic markdown envelope.
    fetchMock.mockResolvedValue(markdownEnvelope(NO_TOPIC_MARKDOWN));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns 200 valid ReportContent with topTopics: [] for every module, and a consistent extraction summary', async () => {
    const { POST } = await import('@/app/api/ai/format-report/route');

    const req = new NextRequest('http://localhost/api/ai/format-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: NO_TOPIC_MARKDOWN,
        reportType: 'regular',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();

    // Strip the transient `extraction` field; the rest must be valid ReportContent.
    const { extraction, ...content } = body;
    const validity = ReportContentV4Schema.safeParse(content);
    expect(validity.success).toBe(true);

    // modules is a non-empty array …
    expect(Array.isArray(content.modules)).toBe(true);
    expect(content.modules.length).toBeGreaterThan(0);

    // … and every module has empty topTopics (pre-feature contract held, R5.1).
    for (const m of content.modules) {
      expect(m.topTopics).toEqual([]);
    }

    // extraction summary is internally consistent: total === Σ extracted (R5.3).
    expect(extraction).toBeDefined();
    expect(extraction.perModule).toHaveLength(content.modules.length);
    const sumExtracted = extraction.perModule.reduce(
      (n: number, p: { extracted: number }) => n + p.extracted,
      0
    );
    expect(extraction.total).toBe(sumExtracted);
    expect(extraction.total).toBe(0);

    // Each in-scope module's outcome is 'empty' given the mocked genuine-empty
    // extraction (failed:false, topics:[]) — distinct from a 'failed' outcome.
    for (const p of extraction.perModule) {
      expect(p.outcome).toBe('empty');
    }
  });
});
