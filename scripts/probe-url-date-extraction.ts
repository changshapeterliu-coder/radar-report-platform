/**
 * Probe: can we reliably extract real published_date from the URLs that
 * Gemini Deep Research cited in its W21 report?
 *
 * Why: the W21 Gemini DR experiment showed that Gemini's *self-reported*
 * citation dates are unreliable (some are months off, one URL is even
 * a topic mismatch). If we want to build the "Gemini DR import + URL
 * verification" pipeline, we must first prove that fetching each URL
 * and extracting a ground-truth date is feasible at scale.
 *
 * What this probe does for each URL:
 *   1. fetch the page (15s timeout, browser-ish UA)
 *   2. attempt date extraction via 4 layered strategies:
 *      - <meta property="article:published_time">
 *      - <meta itemprop="datePublished">
 *      - <script type="application/ld+json"> → datePublished
 *      - visible-text regex: YYYY-MM-DD or YYYY年MM月DD日 or YYYY.MM.DD
 *   3. classify: in W21 window (5/18-5/25 inclusive) / in 1-week buffer
 *      (5/11-5/25) / older / future / unknown
 *   4. extract <title> for relevance sniff (does the title contain any
 *      of the Gemini-claimed-topic keywords?)
 *   5. write a markdown report + JSON dump
 *
 * Run:
 *   npx --yes tsx scripts/probe-url-date-extraction.ts
 *
 * Outputs:
 *   .url-date-probe-results.json  (full data, gitignored)
 *   .url-date-probe-results.md    (human-readable summary)
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────
// Inputs: every citation URL from the Gemini DR W21 report + Gemini's
// claimed topic so we can sniff content match.
// ─────────────────────────────────────────────────────────────────────────

interface Citation {
  id: number;
  url: string;
  geminiClaimedDate: string | null;
  geminiClaimedTopicKeywords: string[];
}

const W21_START = new Date('2026-05-18T00:00:00+08:00').getTime();
const W21_END = new Date('2026-05-25T23:59:59+08:00').getTime();
const W21_BUFFER_START = new Date('2026-05-11T00:00:00+08:00').getTime();

const CITATIONS: Citation[] = [
  {
    id: 1,
    url: 'https://www.wearesellers.com/question/118454',
    geminiClaimedDate: 'this-week',
    geminiClaimedTopicKeywords: ['CPSC', 'Risk-Shield', '秒封', '冻结'],
  },
  {
    id: 2,
    url: 'https://www.niukushipping.com/sys-nr/',
    geminiClaimedDate: null,
    geminiClaimedTopicKeywords: ['充电器', '电池'],
  },
  {
    id: 3,
    url: 'https://t.cj.sina.cn/articles/view/7999171012/1dcc9a9c400102zfjg',
    geminiClaimedDate: '2026-01-09',
    geminiClaimedTopicKeywords: ['账号', '审核', '巴西', '加拿大'],
  },
  {
    id: 4,
    url: 'https://www.tmtpost.com/7842116.html',
    geminiClaimedDate: '2026-01-09',
    geminiClaimedTopicKeywords: ['封号', '巴西', 'KYC'],
  },
  {
    id: 5,
    url: 'https://gs.amazon.cn/zhishi/article-260205-3',
    geminiClaimedDate: null,
    geminiClaimedTopicKeywords: ['政策', '合规', '北美', '欧洲'],
  },
  {
    id: 6,
    url: 'https://m.cifnews.com/tag/zwbydyh',
    geminiClaimedDate: '2026-05-20',
    geminiClaimedTopicKeywords: ['雨果', '跨境'],
  },
  {
    id: 7,
    url: 'https://m.cifnews.com/article/176591',
    geminiClaimedDate: null,
    geminiClaimedTopicKeywords: ['亚马逊', '供应商'],
  },
  {
    id: 8,
    url: 'https://www.yiba18.com/',
    geminiClaimedDate: null,
    geminiClaimedTopicKeywords: ['物流', '跨境'],
  },
  {
    id: 9,
    url: 'https://gs.amazon.cn/news/summary',
    geminiClaimedDate: '2026-07-08',
    geminiClaimedTopicKeywords: ['CPSC', 'eFiling'],
  },
  {
    id: 10,
    url: 'https://www.wearesellers.com/question/119325',
    geminiClaimedDate: '2026-05-12',
    geminiClaimedTopicKeywords: ['CPSC', 'eFiling', '电子申报'],
  },
  {
    id: 11,
    url: 'https://www.wpglb.com/news/industry/3961.html',
    geminiClaimedDate: null,
    geminiClaimedTopicKeywords: ['海关', '5H', '查验'],
  },
  {
    id: 12,
    url: 'https://tool.trade-wind.co/platform/cpsc',
    geminiClaimedDate: null,
    geminiClaimedTopicKeywords: ['CPSC', '合规'],
  },
  {
    id: 13,
    url: 'https://www.ebrun.com/ebrungo/zb/636450.shtml',
    geminiClaimedDate: null,
    geminiClaimedTopicKeywords: ['评论', '变体'],
  },
  {
    id: 14,
    url: 'https://finance.sina.com.cn/tech/roll/2026-01-09/doc-inhfssrv0616720.shtml',
    geminiClaimedDate: '2026-01-09',
    geminiClaimedTopicKeywords: ['评论', '变体', '扫号'],
  },
  {
    id: 15,
    url: 'https://www.ebrun.com/20260109/636131.shtml',
    geminiClaimedDate: '2026-01-09',
    geminiClaimedTopicKeywords: ['扫号', '评论'],
  },
  {
    id: 16,
    url: 'https://m.ennews.com/news-119634.html',
    geminiClaimedDate: null,
    geminiClaimedTopicKeywords: ['评论', '变体', '亿恩'],
  },
  {
    id: 17,
    url: 'https://www.jetech-china.com/h-nd-1062.html',
    geminiClaimedDate: '2026-05-15',
    geminiClaimedTopicKeywords: ['SPS', '裁员', 'AMZ123'],
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Date extraction strategies
// ─────────────────────────────────────────────────────────────────────────

type DateSource =
  | 'meta:article-published'
  | 'meta:itemprop'
  | 'meta:pubdate'
  | 'json-ld'
  | 'body-regex'
  | 'title-regex'
  | 'none';

interface DateHit {
  raw: string;
  iso: string; // YYYY-MM-DD
  source: DateSource;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function normalizeToIso(raw: string): string | null {
  const trimmed = raw.trim();
  // ISO 8601: 2026-05-25T... or 2026-05-25
  const m1 = trimmed.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  // 2026/05/25
  const m2 = trimmed.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m2) return `${m2[1]}-${pad2(+m2[2])}-${pad2(+m2[3])}`;
  // 2026年5月25日 or 2026年05月25日
  const m3 = trimmed.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m3) return `${m3[1]}-${pad2(+m3[2])}-${pad2(+m3[3])}`;
  // 2026.05.25
  const m4 = trimmed.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (m4) return `${m4[1]}-${pad2(+m4[2])}-${pad2(+m4[3])}`;
  return null;
}

function tryMeta(html: string, attr: string, value: string): string | null {
  // <meta {attr}="{value}" content="...">  (attr+value can be flipped)
  const re1 = new RegExp(
    `<meta[^>]+${attr}=["']${value}["'][^>]+content=["']([^"']+)["']`,
    'i'
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${value}["']`,
    'i'
  );
  const m = html.match(re1) ?? html.match(re2);
  return m ? m[1] : null;
}

function extractDates(html: string): DateHit[] {
  const hits: DateHit[] = [];

  // Strategy 1: <meta property="article:published_time">
  const v1 =
    tryMeta(html, 'property', 'article:published_time') ??
    tryMeta(html, 'name', 'article:published_time');
  if (v1) {
    const iso = normalizeToIso(v1);
    if (iso) hits.push({ raw: v1, iso, source: 'meta:article-published' });
  }

  // Strategy 2: <meta name="pubdate"> / <meta name="publishdate">
  const v2 =
    tryMeta(html, 'name', 'pubdate') ??
    tryMeta(html, 'name', 'publishdate') ??
    tryMeta(html, 'name', 'PubDate') ??
    tryMeta(html, 'name', 'publish_date');
  if (v2) {
    const iso = normalizeToIso(v2);
    if (iso) hits.push({ raw: v2, iso, source: 'meta:pubdate' });
  }

  // Strategy 3: <meta itemprop="datePublished">
  const v3 = tryMeta(html, 'itemprop', 'datePublished');
  if (v3) {
    const iso = normalizeToIso(v3);
    if (iso) hits.push({ raw: v3, iso, source: 'meta:itemprop' });
  }

  // Strategy 4: JSON-LD
  const ldMatches = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const m of ldMatches) {
    try {
      const obj = JSON.parse(m[1].trim());
      const candidates: unknown[] = Array.isArray(obj) ? obj : [obj];
      for (const item of candidates) {
        if (item && typeof item === 'object' && 'datePublished' in item) {
          const dp = (item as { datePublished?: unknown }).datePublished;
          if (typeof dp === 'string') {
            const iso = normalizeToIso(dp);
            if (iso) hits.push({ raw: dp, iso, source: 'json-ld' });
          }
        }
      }
    } catch {
      /* ignore malformed json-ld */
    }
  }

  // Strategy 5: visible body regex — extract ALL plausible dates from
  // the page (not just the earliest). Reason: a CN article first-published
  // 2026-01 may still have W21-dated comments / sidebar / "latest" lists
  // showing the topic is *still active*. We want all signals so the
  // classifier downstream can decide.
  const bodyOnly = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const isoMatches = [
    ...bodyOnly.matchAll(/(\d{4})-(\d{2})-(\d{2})(?!\d)/g),
    ...bodyOnly.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g),
    ...bodyOnly.matchAll(/(\d{4})\.(\d{1,2})\.(\d{1,2})(?!\d)/g),
    ...bodyOnly.matchAll(/(\d{4})\/(\d{1,2})\/(\d{1,2})(?!\d)/g),
  ];
  const isoSet: Set<string> = new Set();
  for (const mm of isoMatches) {
    const iso = normalizeToIso(mm[0]);
    if (iso) {
      // Filter out implausible dates (before 2020, after 2030)
      const year = +iso.slice(0, 4);
      if (year >= 2020 && year <= 2030) isoSet.add(iso);
    }
  }
  for (const iso of [...isoSet].sort()) {
    hits.push({ raw: iso, iso, source: 'body-regex' });
  }

  // Strategy 6: <title> regex (last resort)
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const iso = normalizeToIso(titleMatch[1]);
    if (iso) hits.push({ raw: titleMatch[1].trim(), iso, source: 'title-regex' });
  }

  return hits;
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function classifyDate(iso: string | null): {
  bucket: 'in_window' | 'recent_buffer' | 'older' | 'future' | 'unknown';
  daysFromW21Start: number | null;
} {
  if (!iso) return { bucket: 'unknown', daysFromW21Start: null };
  const t = new Date(iso + 'T12:00:00+08:00').getTime();
  const days = Math.round((t - W21_START) / 86400000);
  if (t >= W21_START && t <= W21_END)
    return { bucket: 'in_window', daysFromW21Start: days };
  if (t >= W21_BUFFER_START && t < W21_START)
    return { bucket: 'recent_buffer', daysFromW21Start: days };
  if (t > W21_END) return { bucket: 'future', daysFromW21Start: days };
  return { bucket: 'older', daysFromW21Start: days };
}

function checkContentMatch(html: string, keywords: string[]): {
  matched: string[];
  ratio: number;
} {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  const matched = keywords.filter((kw) => text.includes(kw));
  return { matched, ratio: keywords.length === 0 ? 1 : matched.length / keywords.length };
}

// ─────────────────────────────────────────────────────────────────────────
// Fetch helper
// ─────────────────────────────────────────────────────────────────────────

interface FetchResult {
  ok: boolean;
  status: number;
  html: string;
  errorMessage?: string;
  bytes: number;
}

async function fetchPage(url: string, timeoutMs = 15_000): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    const html = await res.text();
    return { ok: res.ok, status: res.status, html, bytes: html.length };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      html: '',
      bytes: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

interface ProbeResult {
  id: number;
  url: string;
  domain: string;
  geminiClaimedDate: string | null;
  fetchOk: boolean;
  fetchStatus: number;
  fetchBytes: number;
  fetchError?: string;
  title: string;
  dateHits: DateHit[];
  // NEW: classification based on ANY date hit, not just earliest
  hasDateInWindow: boolean;          // any hit ∈ W21 (5/18-5/25)
  hasDateInRecentBuffer: boolean;    // any hit ∈ 5/11-5/17
  hasDateInLast4Weeks: boolean;      // any hit ∈ 4/27-5/25
  earliestDate: string | null;       // earliest hit (≈ original publish)
  latestDate: string | null;         // latest hit (≈ "still active" signal)
  bestSignalBucket:
    | 'active_in_W21'
    | 'active_recent_buffer'
    | 'recent_active_4w'
    | 'stale'
    | 'unknown';
  contentMatchedKeywords: string[];
  contentMatchRatio: number;
}

async function main(): Promise<void> {
  console.log(
    `URL date-extraction probe — ${CITATIONS.length} URLs from Gemini DR W21\n` +
      `W21 window: 2026-05-18 ~ 2026-05-25 (Asia/Shanghai)\n`
  );

  const results: ProbeResult[] = [];

  for (const c of CITATIONS) {
    const t0 = Date.now();
    process.stdout.write(`[${c.id.toString().padStart(2)}] ${c.url} ... `);
    const fetchRes = await fetchPage(c.url);
    const dt = Date.now() - t0;

    const domain = (() => {
      try {
        return new URL(c.url).hostname;
      } catch {
        return '<bad-url>';
      }
    })();

    if (!fetchRes.ok) {
      console.log(
        `FAIL (status=${fetchRes.status}, ${dt}ms${
          fetchRes.errorMessage ? `, ${fetchRes.errorMessage}` : ''
        })`
      );
      results.push({
        id: c.id,
        url: c.url,
        domain,
        geminiClaimedDate: c.geminiClaimedDate,
        fetchOk: false,
        fetchStatus: fetchRes.status,
        fetchBytes: 0,
        fetchError: fetchRes.errorMessage,
        title: '',
        dateHits: [],
        hasDateInWindow: false,
        hasDateInRecentBuffer: false,
        hasDateInLast4Weeks: false,
        earliestDate: null,
        latestDate: null,
        bestSignalBucket: 'unknown',
        contentMatchedKeywords: [],
        contentMatchRatio: 0,
      });
      continue;
    }

    const title = extractTitle(fetchRes.html);
    const dateHits = extractDates(fetchRes.html);
    const allIsos = [...new Set(dateHits.map((h) => h.iso))].sort();

    // Activity bucket: ANY date hit landing in W21 / buffer / last-4w
    const FOUR_WEEKS_AGO = new Date('2026-04-27T00:00:00+08:00').getTime();
    let hasW21 = false;
    let hasBuffer = false;
    let hasLast4w = false;
    for (const iso of allIsos) {
      const t = new Date(iso + 'T12:00:00+08:00').getTime();
      if (t >= W21_START && t <= W21_END) hasW21 = true;
      if (t >= W21_BUFFER_START && t < W21_START) hasBuffer = true;
      if (t >= FOUR_WEEKS_AGO && t <= W21_END) hasLast4w = true;
    }
    const bestSignalBucket: ProbeResult['bestSignalBucket'] = hasW21
      ? 'active_in_W21'
      : hasBuffer
      ? 'active_recent_buffer'
      : hasLast4w
      ? 'recent_active_4w'
      : allIsos.length > 0
      ? 'stale'
      : 'unknown';

    const match = checkContentMatch(fetchRes.html, c.geminiClaimedTopicKeywords);

    console.log(
      `OK (${fetchRes.bytes}B, ${dt}ms) dates=[${allIsos.length}] ` +
        `earliest=${allIsos[0] ?? '?'} latest=${
          allIsos[allIsos.length - 1] ?? '?'
        } bucket=${bestSignalBucket} kw=${match.matched.length}/${
          c.geminiClaimedTopicKeywords.length
        }`
    );

    results.push({
      id: c.id,
      url: c.url,
      domain,
      geminiClaimedDate: c.geminiClaimedDate,
      fetchOk: true,
      fetchStatus: fetchRes.status,
      fetchBytes: fetchRes.bytes,
      title,
      dateHits,
      hasDateInWindow: hasW21,
      hasDateInRecentBuffer: hasBuffer,
      hasDateInLast4Weeks: hasLast4w,
      earliestDate: allIsos[0] ?? null,
      latestDate: allIsos[allIsos.length - 1] ?? null,
      bestSignalBucket,
      contentMatchedKeywords: match.matched,
      contentMatchRatio: match.ratio,
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Aggregate
  // ─────────────────────────────────────────────────────────────────────

  const fetchedOk = results.filter((r) => r.fetchOk).length;
  const dateExtracted = results.filter((r) => r.earliestDate !== null).length;
  const sigW21 = results.filter((r) => r.bestSignalBucket === 'active_in_W21').length;
  const sigBuffer = results.filter((r) => r.bestSignalBucket === 'active_recent_buffer').length;
  const sigRecent4w = results.filter((r) => r.bestSignalBucket === 'recent_active_4w').length;
  const sigStale = results.filter((r) => r.bestSignalBucket === 'stale').length;
  const sigUnknown = results.filter((r) => r.bestSignalBucket === 'unknown').length;
  const lowMatch = results.filter(
    (r) => r.fetchOk && r.contentMatchRatio < 0.5
  ).length;

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('SUMMARY (activity-based, looks for ANY in-window date hit)');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`URLs total:                          ${results.length}`);
  console.log(`Fetch succeeded:                     ${fetchedOk}/${results.length}`);
  console.log(`Page yielded ≥1 date:                ${dateExtracted}/${results.length}`);
  console.log(`  active in W21 window (5/18-5/25):  ${sigW21}`);
  console.log(`  active in buffer (5/11-5/17):      ${sigBuffer}`);
  console.log(`  active in last 4 weeks (4/27-5/25):${sigRecent4w}`);
  console.log(`  stale (no recent date hit):        ${sigStale}`);
  console.log(`  unknown (no date at all):          ${sigUnknown}`);
  console.log(`Content-match < 50% (URL-topic mismatch flag): ${lowMatch}`);

  // ─────────────────────────────────────────────────────────────────────
  // Write outputs
  // ─────────────────────────────────────────────────────────────────────

  const jsonPath = resolve(process.cwd(), '.url-date-probe-results.json');
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        ts: new Date().toISOString(),
        window: { start: '2026-05-18', end: '2026-05-25' },
        results,
        summary: {
          total: results.length,
          fetchedOk,
          dateExtracted,
          activeInW21: sigW21,
          activeRecentBuffer: sigBuffer,
          recentActive4w: sigRecent4w,
          stale: sigStale,
          unknown: sigUnknown,
          lowMatch,
        },
      },
      null,
      2
    ),
    'utf-8'
  );

  const md = renderMarkdown(results);
  const mdPath = resolve(process.cwd(), '.url-date-probe-results.md');
  writeFileSync(mdPath, md, 'utf-8');

  console.log(`\nFull dump → ${jsonPath}`);
  console.log(`Markdown   → ${mdPath}`);
}

function renderMarkdown(results: ProbeResult[]): string {
  const rows = results.map((r) => {
    const claim = r.geminiClaimedDate ?? '—';
    const earliest = r.earliestDate ?? '?';
    const latest = r.latestDate ?? '?';
    const status = r.fetchOk ? `${r.fetchStatus}` : `FAIL`;
    const kw = `${r.contentMatchedKeywords.length}`;
    const flag =
      !r.fetchOk
        ? '❌ fetch'
        : r.bestSignalBucket === 'active_in_W21'
        ? '✅ in-W21'
        : r.bestSignalBucket === 'active_recent_buffer'
        ? '🟢 buffer'
        : r.bestSignalBucket === 'recent_active_4w'
        ? '🟡 last-4w'
        : r.bestSignalBucket === 'stale'
        ? '🔴 stale'
        : '⚠️ unknown';
    return `| ${r.id} | ${r.domain} | ${status} | claim=${claim} | earliest=${earliest} | latest=${latest} | ${r.bestSignalBucket} | ${kw} | ${flag} | ${r.title.slice(0, 60).replace(/\|/g, '\\|')} |`;
  });

  return [
    `# URL date-extraction probe — Gemini DR W21 citations (activity-based)`,
    ``,
    `Window: 2026-05-18 ~ 2026-05-25 (Asia/Shanghai)`,
    `Run: ${new Date().toISOString()}`,
    ``,
    `Bucket logic: each page is classified by the LATEST in-window date found (any signal of activity), not by published_date alone.`,
    ``,
    `| # | domain | http | gemini-claim | earliest | latest | bucket | kw | flag | title |`,
    `|---|---|---|---|---|---|---|---|---|---|`,
    ...rows,
    ``,
  ].join('\n');
}

main().catch((err) => {
  console.error('\nPROBE CRASHED:', err);
  process.exit(1);
});
