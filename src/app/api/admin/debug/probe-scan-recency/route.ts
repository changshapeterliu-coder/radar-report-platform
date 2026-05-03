import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdmin } from '../../_utils/verify-admin';
import { callZai } from '@/lib/research-engine/engines/zai-client';

/**
 * TEMPORARY DIAGNOSTIC ENDPOINT — delete after use.
 *
 * Purpose: diagnose why daily-alert-run's 2026-05-03 scan returned
 * `{topics: []}` after only 12s (production log showed `persist-empty-day`
 * branch taken, `topic_count=0`, `new_canonical_count=0`).
 *
 * Method: fire the SAME prompt 3 times against z.ai GLM-4.6 varying only
 * `search_recency_filter`:
 *   - oneDay  (current production setting for scan.ts)
 *   - oneWeek (moderate loosening)
 *   - noLimit (engine default — baseline)
 *
 * Interpret the comparison to decide the fix:
 *   A=0, B/C>0        → oneDay is a hard filter; change scan.ts to oneWeek
 *   A>0, A.topics=0   → prompt self-censors; loosen "诚实宁可空" clause
 *   A looks normal    → low-signal day; collect another sample before change
 *
 * Auth: admin only. This route will be deleted in the next commit.
 *
 * Safety: read-only. Does not touch any DB table, does not emit Inngest
 * events, does not modify production behaviour.
 *
 * Note: Each GLM call takes up to 240s; the total request may take 8-12
 * minutes to return. Browsers / Vercel may time out; that's OK — the result
 * summary is logged via console regardless (Inngest logs pick it up).
 */

export const maxDuration = 800;

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

interface CaseResult {
  label: 'A_oneDay' | 'B_oneWeek' | 'C_noLimit';
  searchRecency: 'oneDay' | 'oneWeek' | 'noLimit';
  ok: boolean;
  durationMs: number;
  searchCount: number;
  topicsCount: number;
  firstFiveRefs: Array<{
    title: string | null;
    publishDate: string | null;
    provider: string;
  }>;
  errorMessage?: string;
  rawDataPreview?: string; // First 500 chars of the engine's JSON output
}

async function runOne(
  label: CaseResult['label'],
  searchRecency: CaseResult['searchRecency'],
  apiKey: string
): Promise<CaseResult> {
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
      searchRecency,
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
    title: r.title ?? null,
    publishDate: r.published_date ?? null,
    provider: r.provider,
  }));

  return {
    label,
    searchRecency,
    ok: true,
    durationMs,
    searchCount: result.searchCount,
    topicsCount,
    firstFiveRefs,
    rawDataPreview: result.rawContent.slice(0, 500),
  };
}

function diagnose(results: CaseResult[]): string {
  const a = results.find((r) => r.searchRecency === 'oneDay');
  const b = results.find((r) => r.searchRecency === 'oneWeek');
  const c = results.find((r) => r.searchRecency === 'noLimit');
  if (!a || !b || !c) return 'inconclusive: missing case results';

  if (a.searchCount === 0 && (b.searchCount > 0 || c.searchCount > 0)) {
    return (
      `ROOT CAUSE: search_recency_filter='oneDay' returned ZERO refs while ` +
      `oneWeek (${b.searchCount}) / noLimit (${c.searchCount}) returned refs. ` +
      `z.ai's oneDay is an aggressive hard filter on indexable publish_date, ` +
      `and Chinese seller-community sites rarely expose publish_date to indexers. ` +
      `FIX: change scan.ts to searchRecency='oneWeek' (keep the "24h window" semantic ` +
      `in prompt text only — the Zod schema already doesn't enforce per-source date).`
    );
  }

  if (a.searchCount > 0 && a.topicsCount === 0 && b.topicsCount > 0) {
    return (
      `ROOT CAUSE: oneDay returned refs (${a.searchCount}) but engine self-censored topics=[]. ` +
      `With oneWeek the engine returned ${b.topicsCount} topics from ${b.searchCount} refs. ` +
      `FIX: loosen the prompt's "诚实宁可空 / topics:[] 逃生口" wording ` +
      `so the engine reports weak signals with lower hot_score instead of empty array.`
    );
  }

  if (a.searchCount > 0 && a.topicsCount > 0) {
    return (
      `NO ACTION NEEDED in code: oneDay works fine in isolation today. ` +
      `Production empty-day at 2026-05-03 may have been genuine low signal or ` +
      `GLM non-determinism. Recommend: collect another sample in a few hours ` +
      `before any prompt/code change.`
    );
  }

  return (
    `INCONCLUSIVE: all three recency settings returned similar low values. ` +
    `Possible: z.ai backend issue, API key limits, or today really is a quiet ` +
    `news day across all horizons. Collect another sample.`
  );
}

export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const admin = await verifyAdmin(supabase);
  if (!admin) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 },
      { status: 403 }
    );
  }

  const apiKey = process.env.ZAI_API_KEY ?? '';
  if (!apiKey) {
    return NextResponse.json(
      { code: 'CONFIG_ERROR', message: 'ZAI_API_KEY not set', statusCode: 500 },
      { status: 500 }
    );
  }

  console.log('[probe-scan-recency] starting 3-way comparison...');

  const results: CaseResult[] = [];
  for (const [label, recency] of [
    ['A_oneDay', 'oneDay'] as const,
    ['B_oneWeek', 'oneWeek'] as const,
    ['C_noLimit', 'noLimit'] as const,
  ]) {
    console.log(`[probe-scan-recency] ▶ ${label} (${recency})...`);
    const r = await runOne(label, recency, apiKey);
    results.push(r);
    console.log(
      `[probe-scan-recency] ← ${r.ok ? 'OK' : 'FAIL'}  dur=${(r.durationMs / 1000).toFixed(1)}s  refs=${r.searchCount}  topics=${r.topicsCount}`
    );
  }

  const diagnosis = diagnose(results);
  console.log(`[probe-scan-recency] DIAGNOSIS: ${diagnosis}`);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    diagnosis,
    results,
    note: 'This is a temporary diagnostic endpoint. It will be deleted after use.',
  });
}
