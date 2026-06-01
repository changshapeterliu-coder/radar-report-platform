/**
 * Probe: do compliance-focused service providers have public news/blog
 * sections that work as cross-border-Amazon hot-topic signal sources?
 *
 * Hypothesis: 合规服务商（欧税通、J&P、大狮、赛贝、TUV、华测）每周必发
 * 合规公告/政策解读/客户案例 — 因为这是它们的 lead generation 渠道。
 * 信号密度 > 通用媒体（雨果/亿恩），但需要每家定制 selector。
 *
 * Step 1: just verify each site loads + extract candidate article URL
 * patterns. Don't classify yet, output ALL discovered URLs + snippet of
 * page structure for human review.
 *
 * Run:
 *   npx --yes tsx scripts/probe-compliance-service-providers.ts
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface SiteProbe {
  id: string;
  name: string;
  category: string;
  homeUrl: string;
  // candidate news/blog endpoints to try
  newsEndpoints: string[];
}

const SITES: SiteProbe[] = [
  {
    id: 'eustax',
    name: '欧税通 EUStax',
    category: 'VAT 税务',
    homeUrl: 'https://www.eustax.com.cn/',
    newsEndpoints: [
      'https://www.eustax.com.cn/news/',
      'https://www.eustax.com.cn/article/',
      'https://www.eustax.com.cn/zixun/',
      'https://www.eustax.com.cn/',
    ],
  },
  {
    id: 'jp',
    name: 'J&P 集团',
    category: 'VAT 税务 + KYC',
    homeUrl: 'https://www.jpaccountants.com/',
    newsEndpoints: [
      'https://www.jpaccountants.com/news/',
      'https://www.jpaccountants.com/article/',
      'https://www.jpaccountants.com/blog/',
      'https://www.jpaccountants.com/',
    ],
  },
  {
    id: 'wpglb',
    name: 'WP环球（万邑通跨境）',
    category: '物流 + 合规',
    homeUrl: 'https://www.wpglb.com/',
    newsEndpoints: [
      'https://www.wpglb.com/news/industry/',
      'https://www.wpglb.com/news/',
      'https://www.wpglb.com/',
    ],
  },
  {
    id: 'saibei',
    name: '赛贝知识产权',
    category: '知识产权',
    homeUrl: 'https://www.saibei.com.cn/',
    newsEndpoints: [
      'https://www.saibei.com.cn/news/',
      'https://www.saibei.com.cn/zixun/',
      'https://www.saibei.com.cn/',
    ],
  },
  {
    id: 'pingpong',
    name: 'PingPong 福贸',
    category: '跨境收款',
    homeUrl: 'https://www.pingpongx.com/',
    newsEndpoints: [
      'https://www.pingpongx.com/news/',
      'https://www.pingpongx.com/blog/',
      'https://www.pingpongx.com/cn/news/',
      'https://www.pingpongx.com/',
    ],
  },
  {
    id: 'lianlian',
    name: '连连国际',
    category: '跨境收款',
    homeUrl: 'https://global.lianlianpay.com/',
    newsEndpoints: [
      'https://global.lianlianpay.com/news/',
      'https://global.lianlianpay.com/blog/',
      'https://global.lianlianpay.com/article/',
      'https://global.lianlianpay.com/',
    ],
  },
  {
    id: 'tuv',
    name: 'TUV 莱茵',
    category: '检测认证',
    homeUrl: 'https://www.tuv.com/china/zh/',
    newsEndpoints: [
      'https://www.tuv.com/china/zh/news.html',
      'https://www.tuv.com/china/zh/',
    ],
  },
  {
    id: 'cti',
    name: 'CTI 华测检测',
    category: '检测认证',
    homeUrl: 'https://www.cti-cert.com/',
    newsEndpoints: [
      'https://www.cti-cert.com/news/',
      'https://www.cti-cert.com/zixun/',
      'https://www.cti-cert.com/',
    ],
  },
  {
    id: 'damaitong',
    name: '大麦通 / 大狮跨境',
    category: '账户合规 + 申诉',
    homeUrl: 'https://www.damaitong.cn/',
    newsEndpoints: [
      'https://www.damaitong.cn/news/',
      'https://www.damaitong.cn/article/',
      'https://www.damaitong.cn/',
    ],
  },
  {
    id: 'eccang',
    name: '易仓科技',
    category: '跨境ERP + 合规',
    homeUrl: 'https://www.eccang.com/',
    newsEndpoints: [
      'https://www.eccang.com/news/',
      'https://www.eccang.com/blog/',
      'https://www.eccang.com/zixun/',
      'https://www.eccang.com/',
    ],
  },
];

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
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    const html = await res.text();
    return { ok: res.ok, status: res.status, html, bytes: html.length, finalUrl: res.url };
  } catch (err) {
    return { ok: false, status: 0, html: '', bytes: 0, finalUrl: url, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

interface ProbeResult {
  id: string;
  name: string;
  category: string;
  endpointsTried: number;
  bestEndpoint: string;
  bestStatus: number;
  bestBytes: number;
  bestFinalUrl: string;
  // What we discovered
  hasArticleLikeUrls: boolean;
  articleUrlPatterns: string[]; // sample of candidate article URLs
  hasDates: boolean;
  sampleDates: string[];
  hasComplianceKeywords: boolean;
  matchedKeywords: string[];
  pageTitle: string;
}

const COMPLIANCE_KEYWORDS = [
  'AHR', 'AHA', '账户健康', '账户状况', '封号', '账户停用', 'KYC', '二审',
  'Listing 下架', '下架', '侵权', '商标', 'CPSC', 'eFiling', 'GPSR',
  '能效标签', '申诉', 'POA', 'Risk-Shield', 'SPS', '裁员', '7月8日',
  'VAT', '欧税', '税务', '合规', '海关', '5H', '查验', '资质',
  '亚马逊', '跨境',
];

function summarize(html: string): { 
  articleUrls: string[];
  dates: string[];
  matchedKeywords: string[];
  pageTitle: string;
} {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

  // Find article-like URL patterns (any URL that looks like a content URL,
  // not nav/category)
  const allLinks = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const articleLikePatterns = new Set<string>();
  for (const link of allLinks) {
    // patterns like /news/123.html, /article/456, /p/abc, /20260520/123
    if (/\/news[-_/]\d+/.test(link)) articleLikePatterns.add(link);
    else if (/\/article[-_/]\d+/.test(link)) articleLikePatterns.add(link);
    else if (/\/zixun[-_/]\d+/.test(link)) articleLikePatterns.add(link);
    else if (/\/\d{4,7}\.html?$/.test(link)) articleLikePatterns.add(link);
    else if (/\/p\/\w+/.test(link)) articleLikePatterns.add(link);
    else if (/\/blog\/[\w-]+/.test(link)) articleLikePatterns.add(link);
  }

  // Find dates in body (any plausible 2025-2027 date)
  const dates = new Set<string>();
  for (const m of html.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) {
    const yr = +m[1];
    if (yr >= 2025 && yr <= 2027) dates.add(`${m[1]}-${m[2]}-${m[3]}`);
  }
  for (const m of html.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)) {
    dates.add(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  }

  // Plain text from body (strip HTML, scripts, styles)
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ');
  const matchedKeywords = COMPLIANCE_KEYWORDS.filter((kw) => text.includes(kw));

  return {
    articleUrls: [...articleLikePatterns].slice(0, 10),
    dates: [...dates].sort().slice(-10),
    matchedKeywords,
    pageTitle,
  };
}

async function probeSite(site: SiteProbe): Promise<ProbeResult> {
  console.log(`\n══ [${site.id}] ${site.name} (${site.category})`);
  let best: { endpoint: string; status: number; bytes: number; html: string; finalUrl: string } | null = null;
  for (const ep of site.newsEndpoints) {
    process.stdout.write(`    try ${ep}... `);
    const r = await fetchOne(ep);
    if (r.ok) {
      console.log(`OK ${r.status} ${r.bytes}B → ${r.finalUrl}`);
      if (!best || r.bytes > best.bytes) {
        best = { endpoint: ep, status: r.status, bytes: r.bytes, html: r.html, finalUrl: r.finalUrl };
      }
    } else {
      console.log(`FAIL ${r.status} ${r.error ?? ''}`);
    }
  }
  if (!best) {
    return {
      id: site.id,
      name: site.name,
      category: site.category,
      endpointsTried: site.newsEndpoints.length,
      bestEndpoint: '',
      bestStatus: 0,
      bestBytes: 0,
      bestFinalUrl: '',
      hasArticleLikeUrls: false,
      articleUrlPatterns: [],
      hasDates: false,
      sampleDates: [],
      hasComplianceKeywords: false,
      matchedKeywords: [],
      pageTitle: '',
    };
  }
  const summary = summarize(best.html);
  console.log(
    `    BEST: ${best.bytes}B, articles=${summary.articleUrls.length}, dates=${summary.dates.length}, kw=${summary.matchedKeywords.length}`
  );
  if (summary.articleUrls.length > 0) {
    summary.articleUrls.slice(0, 3).forEach((u) => console.log(`      sample url: ${u}`));
  }
  if (summary.dates.length > 0) {
    console.log(`      sample dates: ${summary.dates.slice(0, 5).join(', ')}`);
  }
  console.log(
    `      keywords: ${summary.matchedKeywords.length > 0 ? summary.matchedKeywords.slice(0, 8).join(', ') : '(none)'}`
  );

  return {
    id: site.id,
    name: site.name,
    category: site.category,
    endpointsTried: site.newsEndpoints.length,
    bestEndpoint: best.endpoint,
    bestStatus: best.status,
    bestBytes: best.bytes,
    bestFinalUrl: best.finalUrl,
    hasArticleLikeUrls: summary.articleUrls.length > 0,
    articleUrlPatterns: summary.articleUrls,
    hasDates: summary.dates.length > 0,
    sampleDates: summary.dates,
    hasComplianceKeywords: summary.matchedKeywords.length >= 3,
    matchedKeywords: summary.matchedKeywords,
    pageTitle: summary.pageTitle,
  };
}

async function main(): Promise<void> {
  console.log('Compliance service-provider probe — 10 sites');
  console.log('Goal: identify which providers have a public news section that we can crawl');

  const results: ProbeResult[] = [];
  for (const site of SITES) {
    results.push(await probeSite(site));
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`| site         | bytes  | articles | dates | kw | verdict |`);
  console.log(`|--------------|--------|----------|-------|----|---------|`);
  for (const r of results) {
    const verdict = !r.bestEndpoint
      ? '❌ no fetch'
      : !r.hasArticleLikeUrls
        ? '⚠️ no articles'
        : !r.hasDates
          ? '⚠️ no dates'
          : !r.hasComplianceKeywords
            ? '⚠️ low kw'
            : '✅ usable';
    console.log(
      `| ${r.id.padEnd(12)} | ${String(r.bestBytes).padStart(6)} | ${String(r.articleUrlPatterns.length).padStart(8)} | ${String(r.sampleDates.length).padStart(5)} | ${String(r.matchedKeywords.length).padStart(2)} | ${verdict} |`
    );
  }

  const usable = results.filter(
    (r) => r.hasArticleLikeUrls && r.hasDates && r.hasComplianceKeywords
  );
  console.log(`\nUsable sites: ${usable.length}/${results.length}`);
  console.log(`Sites worth investing extractor effort: ${usable.map((r) => r.name).join(', ')}`);

  // Persist
  const outPath = resolve(process.cwd(), '.compliance-providers-probe.json');
  writeFileSync(outPath, JSON.stringify({ ts: new Date().toISOString(), results }, null, 2), 'utf-8');
  console.log(`\nFull dump → ${outPath}`);
}

main().catch((err) => {
  console.error('CRASHED:', err);
  process.exit(1);
});
