/**
 * Probe: Sogou WeChat search as a Chinese cross-border seller signal source.
 *
 * Hypothesis (after inspecting one query):
 *   - weixin.sogou.com returns real WeChat article links + accounts +
 *     unix timestamps via the public `weixin` endpoint
 *   - tsn=2 ("1周内") restricts to last 7 days
 *   - 10 articles per query × N queries = 50-150 last-week WeChat articles
 *   - This is the *real* signal pipe for Chinese cross-border seller hot
 *     topics (官方 + KOL + 服务商 + 媒体公众号 all show up)
 *
 * What we verify here:
 *   1. Each query returns ≥1 article in W21 window (5/18-5/25)
 *   2. Article timestamps are reliable (epoch from <script> blocks)
 *   3. Article URLs are public WeChat URLs we can resolve later
 *   4. No anti-bot blocking on first ~10 queries
 *
 * Run:
 *   npx --yes tsx scripts/probe-sogou-wechat.ts
 *
 * Outputs:
 *   .sogou-wechat-probe.json
 *   .sogou-wechat-probe.md
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// W21 window
const W21_START = new Date('2026-05-18T00:00:00+08:00').getTime();
const W21_END = new Date('2026-05-25T23:59:59+08:00').getTime();
const TWO_WEEKS_AGO = new Date('2026-05-12T00:00:00+08:00').getTime();
const FOUR_WEEKS_AGO = new Date('2026-04-27T00:00:00+08:00').getTime();

// Sogou WeChat search:
//   type=2 → article search (vs type=1 = account search)
//   tsn=2  → last 7 days   (1=1 day, 3=1 month, 4=1 year, 5=custom)
//   ie=utf8
const QUERIES = [
  '亚马逊 账户健康',
  '亚马逊 二审 KYC',
  '亚马逊 Listing 下架',
  '亚马逊 申诉 POA',
  'Amazon 卖家 封号',
  'AHR 账户状况',
  '亚马逊 关联封号',
  'CPSC eFiling 跨境',
  '亚马逊 SPS 裁员',
  '亚马逊 政策更新',
];

interface SogouArticle {
  title: string;
  account: string;
  url: string; // sogou redirect URL (real WeChat URL needs separate resolve)
  unixTime: number;
  iso: string;
  inW21: boolean;
  in2w: boolean;
  in4w: boolean;
  query: string;
}

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

function unixToIso(t: number): string {
  const d = new Date(t * 1000);
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isInWindow(t: number, start: number, end: number): boolean {
  return t * 1000 >= start && t * 1000 <= end;
}

function parseSogouResults(html: string, query: string): SogouArticle[] {
  // Each result is <li id="sogou_vr_11002601_box_N"> ... </li>
  // Inside:
  //   <h3><a href="...">TITLE</a></h3>  (title may have <em> highlighting that we strip)
  //   <span class="all-time-y2">ACCOUNT</span>
  //   <span class="s2"><script>document.write(timeConvert('TIMESTAMP'))</script></span>
  const results: SogouArticle[] = [];
  const liRegex = /<li id="sogou_vr_\d+_box_\d+"[\s\S]*?<\/li>/g;
  for (const m of html.matchAll(liRegex)) {
    const block = m[0];

    // Title — last <a> in <h3>
    const titleMatch = block.match(/<h3>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;
    const rawHref = titleMatch[1];
    const title = titleMatch[2]
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) continue;

    // Account
    const accMatch = block.match(/class="all-time-y2"[^>]*>([\s\S]*?)<\/span>/);
    const account = accMatch ? accMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // Timestamp from timeConvert('NNNN')
    const tsMatch = block.match(/timeConvert\('(\d+)'\)/);
    if (!tsMatch) continue;
    const unixTime = parseInt(tsMatch[1], 10);
    if (!Number.isFinite(unixTime) || unixTime <= 0) continue;

    // sogou redirect URL — use as-is for now (resolution to mp.weixin.qq.com 
    // requires another hop; we record the redirect for the probe)
    const url = rawHref.startsWith('http') ? rawHref : `https://weixin.sogou.com${rawHref}`;

    const iso = unixToIso(unixTime);
    const inW21 = isInWindow(unixTime, W21_START, W21_END);
    const in2w = isInWindow(unixTime, TWO_WEEKS_AGO, W21_END);
    const in4w = isInWindow(unixTime, FOUR_WEEKS_AGO, W21_END);

    results.push({ title, account, url, unixTime, iso, inW21, in2w, in4w, query });
  }
  return results;
}

interface QueryResult {
  query: string;
  fetchOk: boolean;
  status: number;
  totalArticles: number;
  inW21: number;
  in2w: number;
  in4w: number;
  topAccounts: string[];
  articles: SogouArticle[];
}

async function probeQuery(query: string): Promise<QueryResult> {
  const url =
    `https://weixin.sogou.com/weixin?type=2&tsn=2&ie=utf8&query=` +
    encodeURIComponent(query);
  console.log(`\n── Q: "${query}"`);
  const r = await fetchOne(url);
  if (!r.ok) {
    console.log(`    FAIL ${r.status} ${r.error ?? ''}`);
    return {
      query,
      fetchOk: false,
      status: r.status,
      totalArticles: 0,
      inW21: 0,
      in2w: 0,
      in4w: 0,
      topAccounts: [],
      articles: [],
    };
  }

  const articles = parseSogouResults(r.html, query);
  const inW21 = articles.filter((a) => a.inW21).length;
  const in2w = articles.filter((a) => a.in2w).length;
  const in4w = articles.filter((a) => a.in4w).length;
  const accounts = new Map<string, number>();
  for (const a of articles) accounts.set(a.account, (accounts.get(a.account) ?? 0) + 1);
  const topAccounts = [...accounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([n, c]) => `${n}(${c})`);

  console.log(
    `    OK ${r.bytes}B → ${articles.length} articles, W21=${inW21}, 2w=${in2w}, 4w=${in4w}`
  );
  if (articles.length > 0) {
    articles.slice(0, 3).forEach((a) =>
      console.log(`      [${a.iso}] [${a.account}] ${a.title.slice(0, 60)}`)
    );
  }

  return {
    query,
    fetchOk: true,
    status: r.status,
    totalArticles: articles.length,
    inW21,
    in2w,
    in4w,
    topAccounts,
    articles,
  };
}

async function main(): Promise<void> {
  console.log('Sogou WeChat probe — 10 queries, tsn=2 (last 7 days)');
  console.log(`W21 window: 2026-05-18 ~ 2026-05-25 (Asia/Shanghai)`);

  const results: QueryResult[] = [];
  for (const q of QUERIES) {
    results.push(await probeQuery(q));
    // 1-2s pacing between queries to avoid Sogou rate limiting
    await new Promise((r) => setTimeout(r, 1500));
  }

  // Cross-query dedupe by URL
  const seen = new Set<string>();
  const allArticles: SogouArticle[] = [];
  for (const r of results) {
    for (const a of r.articles) {
      if (seen.has(a.url)) continue;
      seen.add(a.url);
      allArticles.push(a);
    }
  }

  // Aggregate
  const totalUnique = allArticles.length;
  const w21Unique = allArticles.filter((a) => a.inW21).length;
  const w21in2w = allArticles.filter((a) => a.in2w).length;
  const w21in4w = allArticles.filter((a) => a.in4w).length;

  // Account distribution (overall)
  const accCount = new Map<string, number>();
  for (const a of allArticles) accCount.set(a.account, (accCount.get(a.account) ?? 0) + 1);
  const topAccountsOverall = [...accCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Queries:                      ${QUERIES.length}`);
  console.log(`Successful fetches:           ${results.filter((r) => r.fetchOk).length}/${QUERIES.length}`);
  console.log(`Total articles (raw):         ${results.reduce((s, r) => s + r.totalArticles, 0)}`);
  console.log(`Unique articles (deduped):    ${totalUnique}`);
  console.log(`In W21 (5/18-5/25):           ${w21Unique}`);
  console.log(`In last 2 weeks (5/12-5/25):  ${w21in2w}`);
  console.log(`In last 4 weeks (4/27-5/25):  ${w21in4w}`);
  console.log('\nTop 15 accounts (across all queries):');
  topAccountsOverall.forEach(([n, c]) => console.log(`  ${String(c).padStart(3)}× ${n}`));

  // Persist
  const jsonPath = resolve(process.cwd(), '.sogou-wechat-probe.json');
  writeFileSync(
    jsonPath,
    JSON.stringify(
      { ts: new Date().toISOString(), queries: QUERIES, results, allArticles, summary: { totalUnique, w21Unique, w21in2w, w21in4w, topAccountsOverall } },
      null,
      2
    ),
    'utf-8'
  );

  // Markdown summary
  const mdPath = resolve(process.cwd(), '.sogou-wechat-probe.md');
  const md = renderArtifact(results, allArticles, topAccountsOverall);
  writeFileSync(mdPath, md, 'utf-8');

  console.log(`\nFull dump → ${jsonPath}`);
  console.log(`Markdown   → ${mdPath}`);
}

function renderArtifact(
  qResults: QueryResult[],
  all: SogouArticle[],
  topAccounts: [string, number][]
): string {
  const lines: string[] = [
    `# Sogou WeChat search probe — ${new Date().toISOString()}`,
    ``,
    `## Per-query summary`,
    ``,
    `| query | total | W21 | 2w | 4w |`,
    `|-------|-------|-----|----|----|`,
    ...qResults.map(
      (r) =>
        `| ${r.query} | ${r.totalArticles} | ${r.inW21} | ${r.in2w} | ${r.in4w} |`
    ),
    ``,
    `## Top accounts (across all queries)`,
    ``,
    ...topAccounts.map(([n, c]) => `- ${c}× ${n}`),
    ``,
    `## All W21 articles (${all.filter((a) => a.inW21).length})`,
    ``,
  ];
  for (const a of all.filter((x) => x.inW21).sort((a, b) => b.unixTime - a.unixTime)) {
    lines.push(`### [${a.iso}] [${a.account}] ${a.title.slice(0, 100)}`);
    lines.push(`- query: ${a.query}`);
    lines.push(`- url: ${a.url}`);
    lines.push(``);
  }
  return lines.join('\n');
}

main().catch((err) => {
  console.error('CRASHED:', err);
  process.exit(1);
});
