/**
 * Probe: can fetching 10 high-activity Chinese cross-border media /
 * service-provider / KOL / official sites recover the W21 real hot
 * topics (5/15 SPS layoff + CPSC eFiling 7/8 countdown) that
 * Kimi/GLM/Tavily/Gemini DR all missed?
 *
 * Why: weeks of debugging revealed the real failure mode is signal
 * supply on the seller-forum side (knowunknown / amz123 forum / etc).
 * Hypothesis: media + service providers WRITE about hot events first
 * because they're KPI-driven (clicks / leads). If we directly fetch
 * their list pages, we get the real W21 events with accurate timestamps
 * and zero hallucination — without LLM agentic search at all.
 *
 * Strategy:
 *   1. fetch each site's "latest articles" list endpoint (NOT search)
 *   2. extract (title, url, published_date) triples via generic regex
 *   3. classify each article: in W21 window / in W21+W22 buffer / older
 *   4. keyword-filter for our domain (AHR / 二审 / KYC / Listing 下架 /
 *      Risk-Shield / SPS / CPSC / 申诉 / 封号 / 关联 / etc)
 *   5. output: per-site hits, total relevant articles in window,
 *      whether 5/15 SPS layoff + CPSC countdown actually appears.
 *
 * Run:
 *   npx --yes tsx scripts/probe-cn-media-coverage.ts
 *
 * Outputs:
 *   .cn-media-probe-results.json — full data
 *   .cn-media-probe-results.md   — human-readable summary
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────
// Configuration: 10 sites with their list-page endpoints
// ─────────────────────────────────────────────────────────────────────────

interface SiteConfig {
  id: string;
  name: string;
  domain: string;
  // Multiple list endpoints to try (in case one is empty / blocked)
  endpoints: string[];
  category: 'media' | 'service-provider' | 'kol' | 'official';
}

const SITES: SiteConfig[] = [
  {
    id: 's1',
    name: '雨果跨境 / cifnews',
    domain: 'cifnews.com',
    endpoints: [
      'https://m.cifnews.com/category/amz',
      'https://www.cifnews.com/category/amz',
      'https://m.cifnews.com/',
    ],
    category: 'media',
  },
  {
    id: 's2',
    name: '亿恩网 / ennews',
    domain: 'ennews.com',
    endpoints: [
      'https://m.ennews.com/news/',
      'https://www.ennews.com/news/',
      'https://m.ennews.com/',
    ],
    category: 'media',
  },
  {
    id: 's3',
    name: 'AMZ123 资讯',
    domain: 'amz123.com',
    endpoints: [
      'https://m.amz123.com/zb',
      'https://www.amz123.com/zb',
      'https://m.amz123.com/',
    ],
    category: 'media',
  },
  {
    id: 's4',
    name: '亿邦动力 / ebrun',
    domain: 'ebrun.com',
    endpoints: [
      'https://www.ebrun.com/ebrungo/',
      'https://www.ebrun.com/',
      'https://m.ebrun.com/',
    ],
    category: 'media',
  },
  {
    id: 's5',
    name: '邦阅网 / 52by',
    domain: '52by.com',
    endpoints: [
      'https://www.52by.com/article',
      'https://www.52by.com/',
    ],
    category: 'media',
  },
  {
    id: 's6',
    name: '跨境眼 / kuajingyan',
    domain: 'kuajingyan.com',
    endpoints: [
      'https://www.kuajingyan.com/article',
      'https://www.kuajingyan.com/',
    ],
    category: 'service-provider',
  },
  {
    id: 's7',
    name: '网经社 / 100ec',
    domain: '100ec.cn',
    endpoints: [
      'https://www.100ec.cn/index.php/search.html?f=search&terms=%E4%BA%9A%E9%A9%AC%E9%80%8A&w=zh',
      'https://www.100ec.cn/',
    ],
    category: 'media',
  },
  {
    id: 's8',
    name: '卖家精灵 / sellersprite',
    domain: 'sellersprite.com',
    endpoints: [
      'https://www.sellersprite.com/cn/blog',
      'https://www.sellersprite.com/cn/',
    ],
    category: 'kol',
  },
  {
    id: 's9',
    name: '锦品出海 / glosellers',
    domain: 'glosellers.com',
    endpoints: [
      'https://glosellers.com/',
      'https://glosellers.com/category/news',
    ],
    category: 'service-provider',
  },
  {
    id: 's10',
    name: '亚马逊全球开店',
    domain: 'gs.amazon.cn',
    endpoints: [
      'https://gs.amazon.cn/news/summary',
      'https://gs.amazon.cn/news',
    ],
    category: 'official',
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Date windows (Asia/Shanghai)
// ─────────────────────────────────────────────────────────────────────────

const W21_START = new Date('2026-05-18T00:00:00+08:00').getTime();
const W21_END = new Date('2026-05-25T23:59:59+08:00').getTime();
const W22_END = new Date('2026-05-31T23:59:59+08:00').getTime(); // last day this report is being run
const TWO_WEEKS_AGO = new Date('2026-05-12T00:00:00+08:00').getTime();
const FOUR_WEEKS_AGO = new Date('2026-04-27T00:00:00+08:00').getTime();

// ─────────────────────────────────────────────────────────────────────────
// Domain keywords (high-priority signals for the AHS report domain)
// ─────────────────────────────────────────────────────────────────────────

const DOMAIN_KEYWORDS = [
  // Account health
  'AHR', 'AHA', '账户健康', '账户状况', '账号健康', '封号', '账户停用',
  '账户冻结', '关联封号', '二审', '视频验证', 'KYC',
  // Listing / compliance
  'Listing 下架', '下架', '链接下架', '产品下架', '侵权', '商标', '专利',
  '版权投诉', 'CPSC', 'eFiling', 'GPSR', '能效标签', 'CE 认证',
  // Tools / appeal
  '申诉', '挑战', 'Seller Challenge', 'POA', 'Account Health Assurance',
  'Risk-Shield', '风险屏蔽',
  // Recent platform actions  (may catch SPS layoff + CPSC countdown)
  'SPS', 'Selling Partner', '裁员', '客服削减', '7月8日', '7/8', 'efiling',
  // Generic "this week" markers
  '本周', '近期', '紧急', '突发',
];

// ─────────────────────────────────────────────────────────────────────────
// Date-extraction helpers (reused from probe-url-date-extraction.ts)
// ─────────────────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function normalizeToIso(raw: string): string | null {
  const trimmed = raw.trim();
  const m1 = trimmed.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = trimmed.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m2) return `${m2[1]}-${pad2(+m2[2])}-${pad2(+m2[3])}`;
  const m3 = trimmed.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m3) return `${m3[1]}-${pad2(+m3[2])}-${pad2(+m3[3])}`;
  const m4 = trimmed.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (m4) return `${m4[1]}-${pad2(+m4[2])}-${pad2(+m4[3])}`;
  // Relative date: "X天前" → today - X
  const m5 = trimmed.match(/(\d+)\s*天前/);
  if (m5) {
    const days = +m5[1];
    const t = Date.now() - days * 86400000;
    const d = new Date(t);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Article extraction
// ─────────────────────────────────────────────────────────────────────────

interface ArticleHit {
  title: string;
  url: string;
  date: string | null;
  rawDateContext: string | null;
  matchedKeywords: string[];
}

function extractAbsoluteUrl(href: string, baseDomain: string): string | null {
  if (!href) return null;
  if (href.startsWith('http')) {
    try {
      const u = new URL(href);
      // only keep links on same domain (subdomain-tolerant)
      if (u.hostname === baseDomain || u.hostname.endsWith('.' + baseDomain)) {
        return u.href;
      }
    } catch {
      return null;
    }
    return null;
  }
  if (href.startsWith('/')) {
    return `https://${baseDomain.startsWith('m.') ? baseDomain : 'www.' + baseDomain}${href}`;
  }
  return null;
}

function extractArticles(html: string, baseDomain: string): ArticleHit[] {
  // Strategy: find every <a href="..."> ... </a> link, then look at the
  // surrounding 200 chars for a date pattern. Many CN news list pages
  // print the date right next to the title (e.g. "标题 ... 2026-05-19").
  const hits: ArticleHit[] = [];
  const seen = new Set<string>();

  const linkRegex = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]{1,500}?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const inner = match[2];
    const url = extractAbsoluteUrl(href, baseDomain);
    if (!url) continue;
    if (seen.has(url)) continue;

    // Title = stripped inner text
    const title = inner
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title || title.length < 6) continue;
    if (title.length > 200) continue; // probably a banner / nav block, skip

    // Look at surrounding context (300 chars before + 300 after) for a date
    const idx = match.index;
    const ctx = html.slice(Math.max(0, idx - 300), Math.min(html.length, idx + match[0].length + 300));
    const dateCandidates: string[] = [];
    const isoMatches = [
      ...ctx.matchAll(/(\d{4})-(\d{2})-(\d{2})/g),
      ...ctx.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g),
      ...ctx.matchAll(/(\d{4})\.(\d{1,2})\.(\d{1,2})/g),
      ...ctx.matchAll(/(\d{4})\/(\d{1,2})\/(\d{1,2})/g),
      ...ctx.matchAll(/(\d+)\s*天前/g),
    ];
    for (const m of isoMatches) {
      const iso = normalizeToIso(m[0]);
      if (iso) {
        const yr = +iso.slice(0, 4);
        if (yr >= 2024 && yr <= 2027) dateCandidates.push(iso);
      }
    }
    // Pick the latest date in context (publish date is usually the most
    // recent one near the article, not historical mentions inside title)
    dateCandidates.sort();
    const date = dateCandidates[dateCandidates.length - 1] ?? null;

    // keyword match
    const matchedKeywords = DOMAIN_KEYWORDS.filter((kw) =>
      title.toLowerCase().includes(kw.toLowerCase())
    );

    seen.add(url);
    hits.push({ title, url, date, rawDateContext: dateCandidates.join(','), matchedKeywords });
  }

  return hits;
}

// ─────────────────────────────────────────────────────────────────────────
// Fetch
// ─────────────────────────────────────────────────────────────────────────

interface FetchResult {
  ok: boolean;
  status: number;
  html: string;
  bytes: number;
  endpointUsed: string;
  error?: string;
}

async function fetchOneEndpoint(url: string, timeoutMs = 15_000): Promise<FetchResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    const html = await res.text();
    return { ok: res.ok, status: res.status, html, bytes: html.length, endpointUsed: url };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      html: '',
      bytes: 0,
      endpointUsed: url,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSite(site: SiteConfig): Promise<FetchResult> {
  for (const ep of site.endpoints) {
    const r = await fetchOneEndpoint(ep);
    if (r.ok && r.bytes > 5000) return r;
    // try next
  }
  // none worked, return last
  return await fetchOneEndpoint(site.endpoints[site.endpoints.length - 1]);
}

// ─────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────

interface SiteResult {
  id: string;
  name: string;
  domain: string;
  category: SiteConfig['category'];
  fetchOk: boolean;
  fetchStatus: number;
  bytes: number;
  endpointUsed: string;
  totalLinksFound: number;
  articlesWithDate: number;
  articlesInW21: ArticleHit[];
  articlesInTwoWeeks: ArticleHit[]; // 5/12-5/26 buffer
  articlesInFourWeeks: ArticleHit[];
  keywordHitsInW21: ArticleHit[]; // articles in W21 that match domain keywords
  keywordHitsInTwoWeeks: ArticleHit[];
  // captured the two known anchors?
  capturedSpsLayoff: ArticleHit | null;
  capturedCpscCountdown: ArticleHit | null;
}

function isInWindow(iso: string | null, start: number, end: number): boolean {
  if (!iso) return false;
  const t = new Date(iso + 'T12:00:00+08:00').getTime();
  return t >= start && t <= end;
}

async function probeSite(site: SiteConfig): Promise<SiteResult> {
  console.log(`\n── [${site.id}] ${site.name}`);
  const fr = await fetchSite(site);
  if (!fr.ok) {
    console.log(`    ↳ FAIL fetch (status=${fr.status}, ${fr.error ?? ''})`);
    return {
      id: site.id,
      name: site.name,
      domain: site.domain,
      category: site.category,
      fetchOk: false,
      fetchStatus: fr.status,
      bytes: 0,
      endpointUsed: fr.endpointUsed,
      totalLinksFound: 0,
      articlesWithDate: 0,
      articlesInW21: [],
      articlesInTwoWeeks: [],
      articlesInFourWeeks: [],
      keywordHitsInW21: [],
      keywordHitsInTwoWeeks: [],
      capturedSpsLayoff: null,
      capturedCpscCountdown: null,
    };
  }

  const articles = extractArticles(fr.html, site.domain);
  const withDate = articles.filter((a) => a.date !== null);

  const inW21 = withDate.filter((a) => isInWindow(a.date, W21_START, W21_END));
  const inTwoW = withDate.filter((a) => isInWindow(a.date, TWO_WEEKS_AGO, W22_END));
  const inFourW = withDate.filter((a) => isInWindow(a.date, FOUR_WEEKS_AGO, W22_END));

  const kwInW21 = inW21.filter((a) => a.matchedKeywords.length > 0);
  const kwInTwoW = inTwoW.filter((a) => a.matchedKeywords.length > 0);

  // Anchor capture: SPS layoff + CPSC countdown
  const capSps = withDate.find(
    (a) =>
      (a.title.includes('SPS') ||
        a.title.includes('Selling Partner') ||
        (a.title.includes('裁员') && a.title.includes('卖家'))) &&
      isInWindow(a.date, FOUR_WEEKS_AGO, W22_END)
  ) ?? null;
  const capCpsc = withDate.find(
    (a) =>
      (a.title.toLowerCase().includes('cpsc') ||
        a.title.includes('eFiling') ||
        a.title.includes('efiling') ||
        a.title.includes('7月8日') ||
        a.title.includes('7/8')) &&
      isInWindow(a.date, FOUR_WEEKS_AGO, W22_END)
  ) ?? null;

  console.log(
    `    ↳ ${fr.bytes}B, ${articles.length} links, ${withDate.length} dated, ` +
      `W21=${inW21.length} (kw=${kwInW21.length}), 2w=${inTwoW.length} (kw=${kwInTwoW.length}), ` +
      `SPS=${capSps ? '✅' : '✗'}, CPSC=${capCpsc ? '✅' : '✗'}`
  );

  return {
    id: site.id,
    name: site.name,
    domain: site.domain,
    category: site.category,
    fetchOk: true,
    fetchStatus: fr.status,
    bytes: fr.bytes,
    endpointUsed: fr.endpointUsed,
    totalLinksFound: articles.length,
    articlesWithDate: withDate.length,
    articlesInW21: inW21,
    articlesInTwoWeeks: inTwoW,
    articlesInFourWeeks: inFourW,
    keywordHitsInW21: kwInW21,
    keywordHitsInTwoWeeks: kwInTwoW,
    capturedSpsLayoff: capSps,
    capturedCpscCountdown: capCpsc,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    `CN media coverage probe — 10 sites, W21 (5/18-5/25) + W22 buffer (5/12-5/26)\n` +
      `Anchor events to capture: 5/15 SPS 裁员 · CPSC eFiling 7/8 倒计时`
  );

  const results: SiteResult[] = [];
  for (const site of SITES) {
    const r = await probeSite(site);
    results.push(r);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────
  const fetchedOk = results.filter((r) => r.fetchOk).length;
  const totalKwInW21 = results.reduce((s, r) => s + r.keywordHitsInW21.length, 0);
  const totalKwInTwoW = results.reduce((s, r) => s + r.keywordHitsInTwoWeeks.length, 0);
  const sitesWithSps = results.filter((r) => r.capturedSpsLayoff !== null).length;
  const sitesWithCpsc = results.filter((r) => r.capturedCpscCountdown !== null).length;

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Sites fetched OK:                ${fetchedOk}/${SITES.length}`);
  console.log(`Total keyword hits in W21:        ${totalKwInW21}`);
  console.log(`Total keyword hits in 2-week buf: ${totalKwInTwoW}`);
  console.log(`Sites that captured 5/15 SPS:     ${sitesWithSps}`);
  console.log(`Sites that captured CPSC eFiling: ${sitesWithCpsc}`);

  console.log('\n--- Top relevant articles in W21 (5/18-5/25) ---');
  const allW21Hits = results.flatMap((r) =>
    r.keywordHitsInW21.map((a) => ({ ...a, site: r.name }))
  );
  allW21Hits.slice(0, 20).forEach((a, i) => {
    console.log(
      `  [${i + 1}] [${a.site}] ${a.date} kw=${a.matchedKeywords.join(',')}\n      ${a.title}\n      ${a.url}`
    );
  });

  console.log('\n--- Captured anchors ---');
  for (const r of results) {
    if (r.capturedSpsLayoff) {
      console.log(
        `  [SPS] ${r.name} ${r.capturedSpsLayoff.date}: ${r.capturedSpsLayoff.title}\n        ${r.capturedSpsLayoff.url}`
      );
    }
    if (r.capturedCpscCountdown) {
      console.log(
        `  [CPSC] ${r.name} ${r.capturedCpscCountdown.date}: ${r.capturedCpscCountdown.title}\n         ${r.capturedCpscCountdown.url}`
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Persist
  // ─────────────────────────────────────────────────────────────────────
  const jsonPath = resolve(process.cwd(), '.cn-media-probe-results.json');
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        ts: new Date().toISOString(),
        window: { w21Start: '2026-05-18', w21End: '2026-05-25' },
        keywords: DOMAIN_KEYWORDS,
        results,
        summary: {
          fetchedOk,
          totalKwInW21,
          totalKwInTwoW,
          sitesWithSps,
          sitesWithCpsc,
        },
      },
      null,
      2
    ),
    'utf-8'
  );

  const md = renderMarkdown(results, allW21Hits);
  const mdPath = resolve(process.cwd(), '.cn-media-probe-results.md');
  writeFileSync(mdPath, md, 'utf-8');

  console.log(`\nFull dump → ${jsonPath}`);
  console.log(`Markdown   → ${mdPath}`);
}

function renderMarkdown(
  results: SiteResult[],
  allW21Hits: (ArticleHit & { site: string })[]
): string {
  const rows = results.map((r) => {
    return `| ${r.id} | ${r.name} | ${r.category} | ${r.fetchOk ? 'OK' : 'FAIL'} | ${r.totalLinksFound} | ${r.articlesWithDate} | ${r.articlesInW21.length} | ${r.keywordHitsInW21.length} | ${r.capturedSpsLayoff ? '✅' : '✗'} | ${r.capturedCpscCountdown ? '✅' : '✗'} |`;
  });
  const w21List = allW21Hits
    .map(
      (a, i) =>
        `${i + 1}. **[${a.site}]** ${a.date} \`${a.matchedKeywords.join(',')}\`\n   - ${a.title}\n   - ${a.url}`
    )
    .join('\n');
  return [
    `# CN Media Coverage Probe — W21 Anchor Verification`,
    ``,
    `Window: 2026-05-18 ~ 2026-05-25 (Asia/Shanghai)`,
    `Anchors to capture: **5/15 SPS 裁员**, **CPSC eFiling 7/8 倒计时**`,
    `Run: ${new Date().toISOString()}`,
    ``,
    `| # | site | type | fetch | links | dated | W21 articles | W21 kw hits | SPS | CPSC |`,
    `|---|---|---|---|---|---|---|---|---|---|`,
    ...rows,
    ``,
    `## W21-window keyword hits (top 30)`,
    ``,
    w21List,
    ``,
  ].join('\n');
}

main().catch((err) => {
  console.error('\nPROBE CRASHED:', err);
  process.exit(1);
});
