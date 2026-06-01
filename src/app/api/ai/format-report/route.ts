import { NextRequest, NextResponse } from 'next/server';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

/**
 * Markdown-first Smart Paste (see MEMORY.md).
 *
 * The LLM returns PLAIN MARKDOWN — not JSON. Stuffing a full verbatim Chinese
 * docx (tables, quotes, newlines) into a JSON string field is the worst case
 * for JSON-string escaping and was breaking JSON.parse mid-string
 * ("Expected ',' or '}'"). By taking the LLM out of JSON assembly for the
 * fragile big-content part, that entire failure class disappears (Principle 2
 * — architecture over prompt-hope). The ReportContent structure is then
 * assembled DETERMINISTICALLY in code by splitting on `##` headings. This is
 * safe here precisely because Smart Paste sets topTopics = [] — manual pastes
 * skip the topic-extraction pipeline, so there is nothing structured to mine
 * out of the prose.
 */
const SYSTEM_PROMPT = `You are a report formatting assistant. Convert raw pasted report text into clean Markdown. Your job is classification & light restructuring — NOT rewriting.

OUTPUT FORMAT — return ONLY Markdown. No JSON. No code fences wrapping the whole output. Start with exactly two header lines, then the body:

TITLE: <the report title>
DATERANGE: <standardized date range>

## <section title>
<section body in Markdown>

## <next section title>
<section body in Markdown>

RULES:

1. **Do NOT rewrite, summarize, paraphrase, or shorten any content.** Keep original wording verbatim. Your job is to classify & structure, not to edit.

2. **Preserve all information.** Nothing from the source text may be lost.

3. **Sections** — Split the source by natural section breaks (headings like "一、xxx", "二、xxx", "Module 1/2/3", or large empty-line paragraph breaks). Each section starts with a "## " (H2) heading. If the source has no clear section structure, use a single "## Summary" heading for the whole body. Use "###" for sub-sections inside a section. Do NOT use "#" (H1) anywhere in the body — the report title goes in the TITLE: header line only.

4. **Markdown formatting inside each section**:
   - Lists: "-" for bullets, "1." for numbered
   - Preserve bold / italic if the source has them
   - For quotes: \`> [!QUOTE]\` then the verbatim text, then \`— author · source · date\` on a new line
   - For key insights / takeaways: \`> [!INSIGHT]\`
   - For warnings or risks: \`> [!WARNING]\`
   - For action items / recommendations: \`> [!RECOMMENDATION]\`
   - For tabular data: GitHub Markdown tables (| Col | Col |)
   - Keep raw numeric data inline

5. **DATERANGE standardization** — set the DATERANGE header line to one of:
   - full dates: "YYYY-MM-DD ~ YYYY-MM-DD"
   - month only: "YYYY-MM ~ YYYY-MM"
   - quarter only: "YYYY Qx ~ YYYY Qx"
   Normalize 中文日期 / slash-dates / natural language into one of these. This is the ONLY content edit you make. If the source has no date, leave DATERANGE empty.

6. **Keep original language** — Chinese stays Chinese, English stays English. Do not translate.`;

interface ReportModuleLite {
  title: string;
  topTopics: never[];
  markdown: string;
}

interface ReportContentLite {
  title: string;
  dateRange: string;
  modules: ReportModuleLite[];
}

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
      ? 'This is a TOPIC report focusing on a single subject — it may have fewer sections.'
      : 'This is a REGULAR periodic report with multiple sections.';

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        // OpenRouter recommends these for server-side calls; some upstream
        // provider routes return 4xx without them.
        'HTTP-Referer': 'https://radar-report-platform.vercel.app',
        'X-Title': 'Radar Report Platform',
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        // No response_format — the model returns plain Markdown, not JSON.
        // The whole point of markdown-first is that there is no JSON string
        // for the model to mis-escape.
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `${typeHint}\n\nConvert this report text to Markdown per the rules. Emit the TITLE: and DATERANGE: header lines, then the "## " sections. Keep all original wording verbatim, standardize only the date range:\n\n---\n${truncatedText}\n---` },
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
    const content = data?.choices?.[0]?.message?.content;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      console.error('OpenRouter empty response:', JSON.stringify(data));
      return NextResponse.json(
        { error: 'No content returned from AI.' },
        { status: 502 }
      );
    }

    const parsed = buildReportContentFromMarkdown(stripOuterFences(content));

    if (!parsed.modules.length) {
      // Should never happen (buildReportContent always yields ≥1 module), but
      // guard so we never return a structurally-empty report.
      console.error('format-report: produced zero modules. Raw head:', content.slice(0, 500));
      return NextResponse.json(
        { error: 'AI returned content that could not be structured. Please retry.' },
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

/**
 * Some routes still wrap the whole output in ```markdown ... ``` despite the
 * instruction not to. Strip a single outer fence if present.
 */
function stripOuterFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:markdown|md|json)?\r?\n?/i, '')
    .replace(/\r?\n?```$/, '')
    .trim();
}

/**
 * Deterministic Markdown → ReportContent assembly. No LLM, no JSON parse.
 *   1. Pull TITLE: / DATERANGE: header lines off the top.
 *   2. Split the remaining body on "## " (H2) headings into modules.
 *   3. Each module = { title, topTopics: [], markdown }.
 * Falls back to a single "Summary" module when there are no H2 headings.
 */
function buildReportContentFromMarkdown(raw: string): ReportContentLite {
  const { title, dateRange, body } = extractHeader(raw);
  const modules = splitMarkdownIntoModules(body);
  return {
    title: title || 'Untitled report',
    dateRange,
    modules,
  };
}

function extractHeader(md: string): {
  title: string;
  dateRange: string;
  body: string;
} {
  let title = '';
  let dateRange = '';
  const lines = md.split(/\r?\n/);
  const bodyLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const titleMatch = /^TITLE:\s*(.*)$/i.exec(trimmed);
    const dateMatch = /^DATE[\s_-]?RANGE:\s*(.*)$/i.exec(trimmed);
    if (!title && titleMatch) {
      title = titleMatch[1].trim();
      continue;
    }
    if (!dateRange && dateMatch) {
      dateRange = dateMatch[1].trim();
      continue;
    }
    bodyLines.push(line);
  }

  let body = bodyLines.join('\n').trim();

  // Fallback title: a leading H1, else the first non-empty line (de-marked).
  if (!title) {
    const h1 = /^#\s+(.+?)\s*$/m.exec(body);
    if (h1) {
      title = h1[1].trim();
      // Drop that H1 from the body so it isn't rendered twice.
      body = body.replace(h1[0], '').trim();
    } else {
      const firstNonEmpty = bodyLines.find((l) => l.trim().length > 0);
      if (firstNonEmpty) {
        title = firstNonEmpty.trim().replace(/^#+\s*/, '').slice(0, 120);
      }
    }
  }

  return { title, dateRange, body };
}

function splitMarkdownIntoModules(body: string): ReportModuleLite[] {
  if (!body.trim()) {
    return [{ title: 'Summary', topTopics: [], markdown: '' }];
  }

  const lines = body.split(/\r?\n/);
  const preamble: string[] = [];
  const sections: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    // Match "## Heading" but NOT "### Heading" (the char after ## must be a
    // space, so ### — which has ## followed by # — never matches).
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      if (current) sections.push(current);
      current = { title: h2[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push(current);

  // No H2 headings at all → one Summary module holding the whole body.
  if (sections.length === 0) {
    return [{ title: 'Summary', topTopics: [], markdown: body.trim() }];
  }

  // Meaningful text before the first H2 → prepend it to the first section's
  // body (lossless, avoids an awkward empty-title module).
  const preambleText = preamble.join('\n').trim();
  if (preambleText) {
    sections[0].lines = [preambleText, '', ...sections[0].lines];
  }

  return sections.map((s) => ({
    title: s.title,
    topTopics: [] as never[],
    markdown: s.lines.join('\n').trim(),
  }));
}
