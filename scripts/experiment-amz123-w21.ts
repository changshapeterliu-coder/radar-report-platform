/**
 * Local experiment: can a single site (AMZ123) feed a credible W21 hot-topic
 * radar?
 *
 * This is the minimum viable test of the "代码层 fetch list page → LLM
 * judges relevance + writes narrative" architecture before committing to
 * any spec / production work.
 *
 * Steps:
 *   1. fetch AMZ123's /zb (跨境资讯) list page
 *   2. extract every article (title, url, date) — date is parsed from
 *      the title prefix pattern "2026-MM-DD ..." that AMZ123 uses
 *   3. window-filter to W21 (5/18-5/25 inclusive)
 *   4. for each W21 article, fetch the article body (raw_content)
 *   5. dump all candidates to a single file → human review
 *
 * NO LLM yet. We need to verify the raw signal pipeline works first.
 *
 * Run:
 *   npx --yes tsx scripts/experiment-amz123-w21.ts
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const W21_START = new Date('2026-05-18T00:00:00+08:00').getTime();
const W21_END = new Date('2026-05-25T23:59:59+08:00').getTime();

interface Article {
  titleFromList: string;
  url: string;
  dateFromTitle: string | null;
  bodyOk: boolean;
  bodyStatus: number;
  bodyChars: number;
  fullTitle: string | null;
  bodyPreview: string;
}

async function fetchOne(url: string, timeoutMs = 15_000): Promise<{ ok: boolean; status: number; html: string; bytes: number; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    const html = await res.text();
    return { ok: res.ok, status: res.status, html, bytes: html.length };
  } catch (err) {
    return { ok: false, status: 0, html: '', bytes: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function extractAmz123Articles(html: string): { titleFromList: string; url: string; dateFromTitle: string | null }[] {
  // AMZ123 list pattern observed: <a href="..."> 2026-05-22 标题 ... </a>
  // OR              <a href="..."> 标题 ... </a>  with date in nearby span
  const found: { titleFromList: string; url: string; dateFromTitle: string | null }[] = [];
  const seen = new Set<string>();

  const linkRegex = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]{1,500}?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const inner = match[2];

    // Normalize URL — only keep amz123 article links
    let url: string;
    if (href.startsWith('http')) {
      try {
        const u = new URL(href);
        if (!u.hostname.endsWith('amz123.com')) continue;
        url = u.href;
      } catch {
        continue;
      }
    } else if (href.startsWith('/')) {
      url = `https://m.amz123.com${href}`;
    } else {
      continue;
    }

    if (seen.has(url)) continue;

    const title = inner
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title || title.length < 6 || title.length > 200) continue;

    // Date is at the start of the title for AMZ123: "2026-05-22 标题..."
    const dm = title.match(/^(\d{4}-\d{2}-\d{2})/);
    let dateFromTitle: string | null = null;
    if (dm) {
      dateFromTitle = dm[1];
    } else {
      // Fallback: look for date in surrounding context
      const idx = match.index;
      const ctx = html.slice(Math.max(0, idx - 200), Math.min(html.length, idx + match[0].length + 200));
      const cm = ctx.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (cm) dateFromTitle = `${cm[1]}-${cm[2]}-${cm[3]}`;
    }

    seen.add(url);
    found.push({ titleFromList: title, url, dateFromTitle });
  }
  return found;
}

function isInW21(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso + 'T12:00:00+08:00').getTime();
  return t >= W21_START && t <= W21_END;
}

function extractBodyTitleAndPreview(html: string): { fullTitle: string | null; preview: string } {
  let fullTitle: string | null = null;
  const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (tm) fullTitle = tm[1].replace(/\s+/g, ' ').trim();

  // Strip nav / scripts / styles / comments, then collapse whitespace
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { fullTitle, preview: text.slice(0, 800) };
}

async function main(): Promise<void> {
  console.log('Step 1: fetch AMZ123 /zb list page');
  const list = await fetchOne('https://m.amz123.com/zb');
  if (!list.ok) {
    console.error(`FAIL: list page fetch failed (status=${list.status}, ${list.error ?? ''})`);
    process.exit(1);
    return;
  }
  console.log(`    ↳ OK ${list.bytes}B`);

  console.log('\nStep 2: extract candidate articles');
  const candidates = extractAmz123Articles(list.html);
  console.log(`    ↳ ${candidates.length} candidate links found`);

  console.log('\nStep 3: filter to W21 window (5/18 ~ 5/25)');
  const inWindow = candidates.filter((c) => isInW21(c.dateFromTitle));
  console.log(`    ↳ ${inWindow.length} W21 articles`);
  inWindow.forEach((c, i) => console.log(`      [${i + 1}] ${c.dateFromTitle} | ${c.titleFromList.slice(0, 80)}`));

  console.log('\nStep 4: fetch each W21 article body');
  const enriched: Article[] = [];
  for (const c of inWindow) {
    process.stdout.write(`    [${c.dateFromTitle}] ${c.titleFromList.slice(0, 50)}... `);
    const body = await fetchOne(c.url);
    if (!body.ok) {
      console.log(`FAIL (status=${body.status})`);
      enriched.push({ ...c, bodyOk: false, bodyStatus: body.status, bodyChars: 0, fullTitle: null, bodyPreview: '' });
      continue;
    }
    const { fullTitle, preview } = extractBodyTitleAndPreview(body.html);
    console.log(`OK ${body.bytes}B → preview ${preview.length}c`);
    enriched.push({
      ...c,
      bodyOk: true,
      bodyStatus: body.status,
      bodyChars: preview.length,
      fullTitle,
      bodyPreview: preview,
    });
    // gentle pacing
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('\nStep 5: write artifact for human review');
  const outPath = resolve(process.cwd(), '.amz123-w21-experiment.md');
  const md = renderArtifact(enriched);
  writeFileSync(outPath, md, 'utf-8');
  console.log(`    ↳ ${outPath}`);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Candidates from list:           ${candidates.length}`);
  console.log(`In W21 window:                  ${inWindow.length}`);
  console.log(`Body fetch succeeded:           ${enriched.filter((e) => e.bodyOk).length}/${enriched.length}`);
  console.log(`Average body preview length:    ${Math.round(enriched.reduce((s, e) => s + e.bodyChars, 0) / Math.max(1, enriched.length))} chars`);
}

function renderArtifact(articles: Article[]): string {
  const lines: string[] = [
    `# AMZ123 W21 Local Experiment`,
    ``,
    `Run: ${new Date().toISOString()}`,
    `Window: 2026-05-18 ~ 2026-05-25`,
    `Articles: ${articles.length}`,
    ``,
    `---`,
    ``,
  ];
  for (const a of articles) {
    lines.push(`## [${a.dateFromTitle}] ${a.titleFromList.slice(0, 100)}`);
    lines.push(``);
    lines.push(`- URL: ${a.url}`);
    lines.push(`- Full HTML <title>: ${a.fullTitle ?? '(n/a)'}`);
    lines.push(`- Body preview (first 800 chars):`);
    lines.push(``);
    lines.push(`> ${a.bodyPreview.replace(/\n/g, ' ')}`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }
  return lines.join('\n');
}

main().catch((err) => {
  console.error('CRASHED:', err);
  process.exit(1);
});
