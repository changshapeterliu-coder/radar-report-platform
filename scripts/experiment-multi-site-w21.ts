/**
 * Multi-site W21 local experiment.
 *
 * For each site:
 *   1. fetch list page(s) to discover article URLs
 *   2. for each candidate URL, fetch the article body
 *   3. extract real published_date + title + body preview from the
 *      ARTICLE PAGE (not the list — list pages either lack dates or
 *      use ambiguous chrome dates)
 *   4. window-filter to W21 (5/18-5/25)
 *   5. dump everything to a per-site markdown for human review
 *
 * Why fetch the article page for date: AMZ123 puts the date in the title
 * itself, but cifnews / ennews / ebrun put the date in the article body
 * meta tag (article:published_time) or the byline. We need the article
 * page anyway for the body preview, so we get the date there too.
 *
 * Run:
 *   npx --yes tsx scripts/experiment-multi-site-w21.ts
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────

const W21_START = new Date('2026-05-18T00:00:00+08:00').getTime();
const W21_END = new Date('2026-05-25T23:59:59+08:00').getTime();

interface SiteConfig {
  id: string;
  name: string;
  // List endpoints to fetch for URL discovery
  listEndpoints: string[];
  // Regex pattern to find article URLs in list-page HTML
  articleUrlPattern: RegExp;
  // Function to normalize a captured URL fragment to absolute URL
  normalizeUrl: (raw: string) => string;
  // Per-article: extract title + date from the article page HTML
  extractArticleInfo: (html: string) => { title: string | null; date: string | null };
  // Cap on how many candidate URLs to fetch (for politeness)
  maxArticles: number;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function normalizeIso(raw: string): string | null {
  const t = raw.trim();
  const m1 = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = t.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m2) return `${m2[1]}-${pad2(+m2[2])}-${pad2(+m2[3])}`;
  const m3 = t.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m3) return `${m3[1]}-${pad2(+m3[2])}-${pad2(+m3[3])}`;
  return null;
}

function extractMeta(html: string, attrPair: [string, string]): string | null {
  const [attr, val] = attrPair;
  const re1 = new RegExp(`<meta[^>]+${attr}=["']${val}["'][^>]+content=["']([^"']+)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${val}["']`, 'i');
  const m = html.match(re1) ?? html.match(re2);
  return m ? m[1] : null;
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

function extractDateFromArticle(html: string): string | null {
  // Try meta tags first (most reliable)
  const candidates = [
    extractMeta(html, ['property', 'article:published_time']),
    extractMeta(html, ['name', 'article:published_time']),
    extractMeta(html, ['name', 'pubdate']),
    extractMeta(html, ['name', 'PubDate']),
    extractMeta(html, ['name', 'publishdate']),
    extractMeta(html, ['itemprop', 'datePublished']),
  ];
  for (const c of candidates) {
    if (c) {
      const iso = normalizeIso(c);
      if (iso) return iso;
    }
  }
  // Fallback: body regex — pick earliest plausible date in first 5000 chars
  // (article date typically appears early; later dates are usually
  // "related articles" sidebar)
  const head = html.slice(0, 5000);
  const all: string[] = [];
  for (const m of head.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) {
    const yr = +m[1];
    if (yr >= 2024 && yr <= 2027) all.push(`${m[1]}-${m[2]}-${m[3]}`);
  }
  for (const m of head.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)) {
    const iso = normalizeIso(m[0]);
    if (iso) all.push(iso);
  }
  if (all.length === 0) return null;
  // Pick the most-recent date (article-published is typically the latest
  // valid date in the first 5KB; "related" historical articles come later)
  all.sort();
  return all[all.length - 1];
}

const SITES: SiteConfig[] = [
  {
    id: 'amz123',
    name: 'AMZ123 资讯',
    listEndpoints: ['https://m.amz123.com/zb'],
    articleUrlPattern: /\/(t|zb)\/[A-Za-z0-9]+/g,
    normalizeUrl: (raw) => (raw.startsWith('http') ? raw : `https://m.amz123.com${raw}`),
    extractArticleInfo: (html) => ({
      title: extractTitle(html),
      date: extractDateFromArticle(html),
    }),
    maxArticles: 25,
  },
  {
    id: 'cifnews',
    name: '雨果跨境 cifnews',
    listEndpoints: ['https://m.cifnews.com/'],
    articleUrlPattern: /\/article\/\d+/g,
    normalizeUrl: (raw) => (raw.startsWith('http') ? raw : `https://m.cifnews.com${raw}`),
    extractArticleInfo: (html) => ({
      title: extractTitle(html),
      date: extractDateFromArticle(html),
    }),
    maxArticles: 25,
  },
  {
    id: 'ennews',
    name: '亿恩网 ennews',
    listEndpoints: ['https://www.ennews.com/news/', 'https://www.ennews.com/'],
    articleUrlPattern: /\/news-\d+\.html/g,
    normalizeUrl: (raw) => (raw.startsWith('http') ? raw : `https://www.ennews.com${raw}`),
    extractArticleInfo: (html) => ({
      title: extractTitle(html),
      date: extractDateFromArticle(html),
    }),
    maxArticles: 25,
  },
  {
    id: 'ebrun',
    name: '亿邦动力 ebrun',
    listEndpoints: ['https://m.ebrun.com/'],
    articleUrlPattern: /\/\d{6,7}\.html/g, // m.ebrun.com/669394.html style
    normalizeUrl: (raw) => (raw.startsWith('http') ? raw : `https://m.ebrun.com${raw}`),
    extractArticleInfo: (html) => ({
      title: extractTitle(html),
      date: extractDateFromArticle(html),
    }),
    maxArticles: 25,
  },
  {
    id: 'glosellers',
    name: '锦品出海 glosellers',
    listEndpoints: ['https://glosellers.com/'],
    articleUrlPattern: /\/\d{4,6}\.html/g, // glosellers.com/79671.html
    normalizeUrl: (raw) => (raw.startsWith('http') ? raw : `https://glosellers.com${raw}`),
    extractArticleInfo: (html) => ({
      title: extractTitle(html),
      date: extractDateFromArticle(html),
    }),
    maxArticles: 25,
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Fetch
// ─────────────────────────────────────────────────────────────────────────

async function fetchOne(url: string, timeoutMs = 15_000) {
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

function isInW21(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso + 'T12:00:00+08:00').getTime();
  return t >= W21_START && t <= W21_END;
}

function bodyPreview(html: string, maxChars = 1000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

// ─────────────────────────────────────────────────────────────────────────
// Per-site experiment
// ─────────────────────────────────────────────────────────────────────────

interface ArticleResult {
  url: string;
  title: string | null;
  date: string | null;
  inWindow: boolean;
  bodyOk: boolean;
  bodyChars: number;
  preview: string;
}

interface SiteSummary {
  id: string;
  name: string;
  listFetched: boolean;
  candidatesFound: number;
  articlesFetched: number;
  articlesInW21: number;
  results: ArticleResult[];
}

async function runSite(site: SiteConfig): Promise<SiteSummary> {
  console.log(`\n══ [${site.id}] ${site.name}`);

  // 1. fetch list endpoints, collect candidate article URLs
  const candidates = new Set<string>();
  let anyListOk = false;
  for (const ep of site.listEndpoints) {
    const r = await fetchOne(ep);
    if (!r.ok) {
      console.log(`    list fetch FAIL ${ep}: status=${r.status}`);
      continue;
    }
    anyListOk = true;
    console.log(`    list OK ${ep} (${r.bytes}B)`);
    for (const m of r.html.matchAll(site.articleUrlPattern)) {
      const fullUrl = site.normalizeUrl(m[0]);
      candidates.add(fullUrl);
    }
  }
  console.log(`    ↳ ${candidates.size} candidate article URLs`);
  if (candidates.size === 0) {
    return {
      id: site.id,
      name: site.name,
      listFetched: anyListOk,
      candidatesFound: 0,
      articlesFetched: 0,
      articlesInW21: 0,
      results: [],
    };
  }

  // 2. fetch each article (up to maxArticles), extract date + title + preview
  const limited = [...candidates].slice(0, site.maxArticles);
  const results: ArticleResult[] = [];
  let inWindowCount = 0;
  for (let i = 0; i < limited.length; i++) {
    const url = limited[i];
    process.stdout.write(`    [${i + 1}/${limited.length}] ${url.slice(0, 70)}... `);
    const r = await fetchOne(url);
    if (!r.ok) {
      console.log(`FAIL ${r.status}`);
      results.push({ url, title: null, date: null, inWindow: false, bodyOk: false, bodyChars: 0, preview: '' });
      continue;
    }
    const info = site.extractArticleInfo(r.html);
    const inWin = isInW21(info.date);
    if (inWin) inWindowCount++;
    const preview = bodyPreview(r.html, 1000);
    console.log(`OK date=${info.date ?? '?'} ${inWin ? '✅' : ''}`);
    results.push({
      url,
      title: info.title,
      date: info.date,
      inWindow: inWin,
      bodyOk: true,
      bodyChars: preview.length,
      preview,
    });
    // pacing
    await new Promise((r) => setTimeout(r, 400));
  }

  return {
    id: site.id,
    name: site.name,
    listFetched: anyListOk,
    candidatesFound: candidates.size,
    articlesFetched: results.length,
    articlesInW21: inWindowCount,
    results,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Multi-site W21 local experiment — 5 sites, fetch + window filter, no LLM');
  console.log(`Window: 2026-05-18 ~ 2026-05-25 (Asia/Shanghai)`);

  const summaries: SiteSummary[] = [];
  for (const site of SITES) {
    summaries.push(await runSite(site));
  }

  // ─── Summary ─────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`| site       | listOk | candidates | fetched | W21 |`);
  console.log(`|------------|--------|------------|---------|-----|`);
  for (const s of summaries) {
    console.log(
      `| ${s.id.padEnd(10)} | ${s.listFetched ? 'OK    ' : 'FAIL  '} | ${String(s.candidatesFound).padStart(10)} | ${String(s.articlesFetched).padStart(7)} | ${String(s.articlesInW21).padStart(3)} |`
    );
  }
  const totalW21 = summaries.reduce((sum, s) => sum + s.articlesInW21, 0);
  console.log(`\nTotal W21 articles across 5 sites: ${totalW21}`);

  // ─── Write artifact ───────────────────────────────────────────
  const outPath = resolve(process.cwd(), '.multi-site-w21-experiment.md');
  writeFileSync(outPath, renderArtifact(summaries), 'utf-8');
  console.log(`\nArtifact → ${outPath}`);
}

function renderArtifact(summaries: SiteSummary[]): string {
  const lines: string[] = [
    `# Multi-site W21 Experiment`,
    ``,
    `Run: ${new Date().toISOString()}`,
    `Window: 2026-05-18 ~ 2026-05-25`,
    ``,
    `## Site coverage summary`,
    ``,
    `| site | candidates | fetched | W21 articles |`,
    `|------|-----------|---------|--------------|`,
    ...summaries.map(
      (s) =>
        `| **${s.name}** | ${s.candidatesFound} | ${s.articlesFetched} | ${s.articlesInW21} |`
    ),
    ``,
    `---`,
    ``,
  ];
  for (const s of summaries) {
    lines.push(`## ${s.name}`);
    lines.push(``);
    const w21 = s.results.filter((r) => r.inWindow);
    if (w21.length === 0) {
      lines.push(`_(no W21 articles)_`);
      lines.push(``);
      continue;
    }
    for (const a of w21) {
      lines.push(`### [${a.date}] ${(a.title ?? '(no title)').slice(0, 100)}`);
      lines.push(``);
      lines.push(`- URL: ${a.url}`);
      lines.push(``);
      lines.push(`Body preview (1000 chars):`);
      lines.push(``);
      lines.push(`> ${a.preview.replace(/\n/g, ' ')}`);
      lines.push(``);
      lines.push(`---`);
      lines.push(``);
    }
  }
  return lines.join('\n');
}

main().catch((err) => {
  console.error('CRASHED:', err);
  process.exit(1);
});
