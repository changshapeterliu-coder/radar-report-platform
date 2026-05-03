/**
 * Live-API 3-way comparison probe: how does `search_recency_filter` behave
 * on z.ai's chat-completions `tools: [{web_search}]` path for our daily-alert
 * use case?
 *
 * Hypothesis being tested:
 *   The daily-alert-run on 2026-05-03 returned `{topics: []}` after only 12s
 *   of scan. We want to know: did GLM search and get nothing back, or did it
 *   search and get "only a few, mostly stale" and self-censor to [] per prompt?
 *
 *   Specifically: is `oneDay` effectively a hard filter that drops most
 *   Chinese seller-community content (because those sites rarely expose
 *   publish_date to indexers), leaving the engine with too few signals?
 *
 * Method: fire the SAME prompt 3 times, varying only `search_recency_filter`:
 *   [A] oneDay   — current production setting
 *   [B] oneWeek  — moderate loosening
 *   [C] noLimit  — no recency filter (engine default)
 *
 * For each, report:
 *   - ok / error
 *   - searchReferences.length
 *   - sample of (title, publish_date, source_label) for first 5 refs
 *   - whether the engine returned a non-empty `topics[]` array
 *   - wall-clock duration
 *
 * Run:
 *   $env:ZAI_API_KEY = "sk-..."
 *   npx --yes tsx scripts/probe-daily-scan-recency.ts
 *
 * Exit code 0 always (this is a diagnostic, not a gate).
 */

import { callZai } from '../src/lib/research-engine/engines/zai-client';

const PROMPT = `# 角色
你是亚马逊中国卖家账户健康领域的每日热点话题侦察员。

# 使命
在最近 24 小时内扫描中国跨境卖家公开社交媒体渠道，识别 Top 5 可能驱动卖家
向 Amazon 支持团队升级咨询的热点话题。

# 数据源范围
社媒：小红书、抖音、知无不言、卖家之家、雨果网、亿恩网、AMZ123、跨境知道。

# 输出
只返回合法 JSON（不要 markdown 围栏）：
{
  "topics": [
    { "topic": "<中文话题名 ≤20 字>", "hot_score": <int 0..100> }
  ]
}

找不到就返回 {"topics": []}。
`;

interface ProbeResult {
  label: string;
  ok: boolean;
  durationMs: number;
  searchCount: number;
  topicsCount: number;
  firstFiveRefs: Array<{ title: string | undefined; publishDate: string | undefined; provider: string }>;
  errorMessage?: string;
}

async function runOne(
  label: string,
  searchRecency: 'oneDay' | 'oneWeek' | 'noLimit',
  apiKey: string
): Promise<ProbeResult> {
  const start = Date.now();
  const result = await callZai<{ topics?: unknown[] }>({
    model: 'glm-4.6',
    messages: [{ role: 'user', content: PROMPT }],
    apiKey,
    timeoutMs: 240_000,
    jsonMode: true,
    enableWebSearch: true,
    searchRecency,
    contentSize: 'high',
    errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
  });
  const durationMs = Date.now() - start;

  if (!result.ok) {
    return {
      label,
      ok: false,
      durationMs,
      searchCount: 0,
      topicsCount: 0,
      firstFiveRefs: [],
      errorMessage: `${result.error.errorClass}: ${result.error.message}`,
    };
  }

  const topicsCount = Array.isArray(result.data?.topics) ? result.data.topics.length : 0;
  const firstFiveRefs = result.searchReferences.slice(0, 5).map((r) => ({
    title: r.title,
    publishDate: r.published_date,
    provider: r.provider,
  }));

  return {
    label,
    ok: true,
    durationMs,
    searchCount: result.searchCount,
    topicsCount,
    firstFiveRefs,
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    console.error('PROBE FAIL: ZAI_API_KEY not set');
    process.exit(1);
    return;
  }

  const cases: Array<['A' | 'B' | 'C', 'oneDay' | 'oneWeek' | 'noLimit']> = [
    ['A', 'oneDay'],
    ['B', 'oneWeek'],
    ['C', 'noLimit'],
  ];

  const results: ProbeResult[] = [];
  for (const [letter, recency] of cases) {
    const label = `${letter} / search_recency_filter=${recency}`;
    console.log(`\n▶ Starting ${label}...`);
    const r = await runOne(label, recency, apiKey);
    results.push(r);
    console.log(`  ← ${r.ok ? 'OK' : 'FAIL'}  duration=${(r.durationMs / 1000).toFixed(1)}s  web_search[].length=${r.searchCount}  topics.length=${r.topicsCount}`);
    if (r.errorMessage) {
      console.log(`    error: ${r.errorMessage}`);
    } else if (r.firstFiveRefs.length > 0) {
      console.log('    first 5 refs:');
      for (const ref of r.firstFiveRefs) {
        console.log(`      - ${JSON.stringify({ title: (ref.title ?? '').slice(0, 60), publishDate: ref.publishDate ?? '(empty)' })}`);
      }
    } else {
      console.log('    (no refs returned)');
    }
  }

  console.log('\n════════════════ Summary Table ════════════════');
  console.log('label                             | refs | topics | dur(s) | ok');
  console.log('──────────────────────────────────┼──────┼────────┼────────┼────');
  for (const r of results) {
    const label = r.label.padEnd(33);
    const refs = String(r.searchCount).padStart(4);
    const topics = String(r.topicsCount).padStart(6);
    const dur = (r.durationMs / 1000).toFixed(1).padStart(6);
    const ok = r.ok ? 'yes' : 'NO ';
    console.log(`${label} | ${refs} | ${topics} | ${dur} | ${ok}`);
  }
  console.log('══════════════════════════════════════════════');

  console.log('\nDiagnosis:');
  const a = results.find((r) => r.label.includes('oneDay'));
  const b = results.find((r) => r.label.includes('oneWeek'));
  const c = results.find((r) => r.label.includes('noLimit'));
  if (a && b && c) {
    if (a.searchCount === 0 && (b.searchCount > 0 || c.searchCount > 0)) {
      console.log('  → oneDay returns ZERO refs while oneWeek/noLimit do not.');
      console.log('    This confirms: oneDay is an aggressive hard filter incompatible');
      console.log('    with Chinese seller-community sites that lack indexable publish_date.');
      console.log('    RECOMMENDED FIX: change scan.ts to searchRecency="oneWeek",');
      console.log('    keep the 24h window semantic in the prompt text only.');
    } else if (a.searchCount > 0 && a.topicsCount === 0 && b.topicsCount > 0) {
      console.log('  → oneDay returns refs but engine self-censored topics:[].');
      console.log('    Refs count: oneDay=' + a.searchCount + ', oneWeek=' + b.searchCount);
      console.log('    RECOMMENDED FIX: loosen prompt\'s "诚实宁可空" wording.');
    } else if (a.searchCount > 0 && a.topicsCount > 0) {
      console.log('  → oneDay works fine in isolation. Today\'s production empty-day');
      console.log('    was a genuine low-signal day OR reflects non-determinism. Worth');
      console.log('    another sample in a few hours before prompt changes.');
    } else {
      console.log('  → Inconclusive. All three returned zero or uniform results.');
    }
  }

  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(
    `PROBE FAIL (unhandled): ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
});
