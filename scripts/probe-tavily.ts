/**
 * Live-API probe for Tavily Search.
 *
 * Purpose: validate whether Tavily can return useful, time-bounded results
 * for the AHS / cross-border-Amazon-compliance domain. If yes, we replace
 * (or augment) the LLM-builtin web_search in the weekly + daily pipelines.
 *
 * Probes 3 representative seed queries:
 *   1. "亚马逊卖家 账户健康"           — AHA / AHR / 二审
 *   2. "亚马逊 listing 下架 违规"      — listing compliance
 *   3. "Amazon seller account suspended appeal" — English appeal
 *
 * For each query:
 *   - topic=news, search_depth=advanced, max_age_days=7
 *   - max_results=15, include_raw_content="text"
 *
 * Output:
 *   - per-query summary (count, urls, dates, raw_content lengths)
 *   - cross-query dedupe count (by URL)
 *   - 5-sample full record dump
 *   - full JSON written to .tavily-probe-results.json (gitignored)
 *
 * Run:
 *   npx --yes tsx --env-file=.env.local scripts/probe-tavily.ts
 *
 * Free tier: 1,000 credits/month, no card. This probe = 3 credits.
 *
 * Exit codes:
 *   0 — PROBE PASS (≥1 query returned ≥1 result)
 *   1 — PROBE FAIL (missing key, network error, all queries empty)
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface TavilyResult {
  title: string;
  url: string;
  content: string; // Tavily's snippet
  raw_content?: string | null; // full extracted page text
  score: number;
  published_date?: string | null;
}

interface TavilyResponse {
  query: string;
  answer?: string | null;
  results: TavilyResult[];
  response_time?: number;
}

interface ProbeQuery {
  id: string;
  query: string;
  language: 'zh' | 'en';
  note: string;
}

const PROBE_QUERIES: ProbeQuery[] = [
  {
    id: 'q1',
    query: '亚马逊卖家 账户健康',
    language: 'zh',
    note: 'AHA / AHR / 二审 — Chinese cross-border community signal',
  },
  {
    id: 'q2',
    query: '亚马逊 listing 下架 违规',
    language: 'zh',
    note: 'listing compliance / takedowns — Chinese',
  },
  {
    id: 'q3',
    query: 'Amazon seller account suspended appeal',
    language: 'en',
    note: 'English appeal / suspension — global signal',
  },
];

async function tavilySearch(
  apiKey: string,
  query: string
): Promise<TavilyResponse> {
  const body = {
    api_key: apiKey,
    query,
    topic: 'news',
    search_depth: 'advanced',
    max_results: 15,
    days: 7, // last-7-days window for news topic
    include_raw_content: 'text',
    include_answer: false,
  };

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tavily HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  return (await res.json()) as TavilyResponse;
}

function summarizeResult(r: TavilyResult): string {
  const dom = (() => {
    try {
      return new URL(r.url).hostname;
    } catch {
      return '<bad-url>';
    }
  })();
  const date = r.published_date ?? '<no-date>';
  const rawLen = r.raw_content ? r.raw_content.length : 0;
  const snipLen = r.content?.length ?? 0;
  return `  • [${date}] ${dom} (snippet=${snipLen}c, raw=${rawLen}c, score=${r.score.toFixed(2)})\n    ${r.title}\n    ${r.url}`;
}

async function main(): Promise<void> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.error(
      'PROBE FAIL: TAVILY_API_KEY not set.\n' +
        '  Get a free key at https://app.tavily.com (1k credits/mo, no card).\n' +
        '  Then add TAVILY_API_KEY=tvly-... to .env.local'
    );
    process.exit(1);
    return;
  }

  console.log(
    `Tavily probe — ${PROBE_QUERIES.length} queries, max_age=7d, max_results=15 each\n`
  );

  const allResponses: Array<{ probe: ProbeQuery; response: TavilyResponse }> = [];
  let totalRaw = 0;

  for (const probe of PROBE_QUERIES) {
    console.log(`── [${probe.id}] "${probe.query}" (${probe.language})`);
    console.log(`    intent: ${probe.note}`);
    const t0 = Date.now();
    try {
      const response = await tavilySearch(apiKey, probe.query);
      const dt = Date.now() - t0;
      console.log(`    ↳ ${response.results.length} results in ${dt}ms`);
      response.results.slice(0, 5).forEach((r) => {
        console.log(summarizeResult(r));
      });
      if (response.results.length > 5) {
        console.log(`  ... (+${response.results.length - 5} more)`);
      }
      console.log('');
      allResponses.push({ probe, response });
      totalRaw += response.results.length;
    } catch (err) {
      console.error(
        `    ↳ ERROR: ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
  }

  if (totalRaw === 0) {
    console.error('PROBE FAIL: all queries returned 0 results');
    process.exit(1);
    return;
  }

  // ---- Cross-query dedupe ----
  const seen = new Set<string>();
  const unique: Array<{
    probe: ProbeQuery;
    result: TavilyResult;
  }> = [];
  for (const { probe, response } of allResponses) {
    for (const result of response.results) {
      if (seen.has(result.url)) continue;
      seen.add(result.url);
      unique.push({ probe, result });
    }
  }

  // ---- Domain frequency ----
  const domainCount = new Map<string, number>();
  unique.forEach(({ result }) => {
    try {
      const d = new URL(result.url).hostname;
      domainCount.set(d, (domainCount.get(d) ?? 0) + 1);
    } catch {
      /* ignore */
    }
  });
  const topDomains = [...domainCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // ---- Date distribution ----
  const dateBuckets = new Map<string, number>();
  unique.forEach(({ result }) => {
    const d = result.published_date
      ? result.published_date.slice(0, 10)
      : '<no-date>';
    dateBuckets.set(d, (dateBuckets.get(d) ?? 0) + 1);
  });
  const sortedDates = [...dateBuckets.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  // ---- Raw-content stats ----
  const rawLengths = unique
    .map(({ result }) => result.raw_content?.length ?? 0)
    .filter((n) => n > 0);
  const rawAvg =
    rawLengths.length > 0
      ? Math.round(rawLengths.reduce((a, b) => a + b, 0) / rawLengths.length)
      : 0;
  const rawMissing = unique.length - rawLengths.length;

  console.log('═══════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Total raw results:     ${totalRaw}`);
  console.log(`After URL dedupe:      ${unique.length}`);
  console.log(
    `Raw_content present:   ${rawLengths.length}/${unique.length}` +
      (rawMissing > 0 ? ` (${rawMissing} missing)` : '')
  );
  console.log(`Raw_content avg chars: ${rawAvg}`);

  console.log('\nTop domains:');
  topDomains.forEach(([d, n]) => console.log(`  ${n.toString().padStart(3)}× ${d}`));

  console.log('\nDate distribution:');
  sortedDates.forEach(([d, n]) =>
    console.log(`  ${n.toString().padStart(3)}× ${d}`)
  );

  // ---- Sample 5 full records (with raw_content excerpt) ----
  console.log('\nSample 5 full records (raw_content preview, 400c):');
  unique.slice(0, 5).forEach(({ probe, result }, i) => {
    console.log(
      `\n  [${i + 1}] from ${probe.id} | ${result.published_date ?? '<no-date>'}`
    );
    console.log(`      title: ${result.title}`);
    console.log(`      url:   ${result.url}`);
    console.log(`      snippet: ${result.content.slice(0, 200).replace(/\s+/g, ' ')}…`);
    if (result.raw_content) {
      console.log(
        `      raw:   ${result.raw_content.slice(0, 400).replace(/\s+/g, ' ')}…`
      );
    } else {
      console.log(`      raw:   <none>`);
    }
  });

  // ---- Write full dump ----
  const dumpPath = resolve(process.cwd(), '.tavily-probe-results.json');
  writeFileSync(
    dumpPath,
    JSON.stringify(
      {
        ts: new Date().toISOString(),
        queries: PROBE_QUERIES,
        responses: allResponses.map(({ probe, response }) => ({
          probeId: probe.id,
          query: probe.query,
          resultCount: response.results.length,
          results: response.results,
        })),
        summary: {
          totalRaw,
          uniqueAfterDedup: unique.length,
          rawContentPresent: rawLengths.length,
          rawContentMissing: rawMissing,
          rawContentAvgChars: rawAvg,
          topDomains,
          dateDistribution: sortedDates,
        },
      },
      null,
      2
    ),
    'utf-8'
  );
  console.log(`\nFull dump → ${dumpPath}`);
  console.log('\nPROBE PASS');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(
    `PROBE FAIL: unhandled error: ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
});
