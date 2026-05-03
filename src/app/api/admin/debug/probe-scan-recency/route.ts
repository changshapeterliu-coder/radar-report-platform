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
  label: 'A_oneDay' | 'B_oneWeek' | 'C_noLimit' | 'D_oneWeek_toolRequired';
  searchRecency: 'oneDay' | 'oneWeek' | 'noLimit';
  toolChoice: 'auto' | 'required';
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
  toolChoice: CaseResult['toolChoice'],
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
    toolChoice: toolChoice === 'auto' ? undefined : toolChoice,
    errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
  });
  const durationMs = Date.now() - start;

  if (!result.ok) {
    return {
      label,
      searchRecency,
      toolChoice,
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
    toolChoice,
    ok: true,
    durationMs,
    searchCount: result.searchCount,
    topicsCount,
    firstFiveRefs,
    rawDataPreview: result.rawContent.slice(0, 500),
  };
}

function diagnose(results: CaseResult[]): string {
  const a = results.find((r) => r.label === 'A_oneDay');
  const b = results.find((r) => r.label === 'B_oneWeek');
  const c = results.find((r) => r.label === 'C_noLimit');
  const d = results.find((r) => r.label === 'D_oneWeek_toolRequired');
  if (!a || !b || !c || !d) return 'inconclusive: missing case results';

  // Prior experiment (2026-05-03 first pass) showed ALL of A/B/C returned
  // searchCount=0 + topicsCount=5 — i.e. GLM was bypassing the web_search
  // tool entirely and hallucinating topics from training data. Case D tests
  // whether tool_choice='required' forces GLM to actually call the tool.

  const bypassInABC =
    a.searchCount === 0 &&
    b.searchCount === 0 &&
    c.searchCount === 0 &&
    a.topicsCount > 0;

  if (bypassInABC && !d.ok) {
    return (
      `tool_choice='required' was REJECTED by z.ai: ${d.errorMessage ?? '(no error message)'}. ` +
      `The API layer cannot force tool use. FIX: fall back to a prompt-layer ` +
      `hard rule ("必须至少调用 web_search 3 次，严禁从训练知识回忆").`
    );
  }

  if (bypassInABC && d.ok && d.searchCount > 0) {
    return (
      `ROOT CAUSE CONFIRMED: GLM-4.6 defaults to bypassing the web_search tool ` +
      `(A/B/C all returned searchCount=0 but topicsCount=${a.topicsCount} from ` +
      `training knowledge). tool_choice='required' FIXES this: D returned ` +
      `searchCount=${d.searchCount} topicsCount=${d.topicsCount} in ${(d.durationMs / 1000).toFixed(1)}s. ` +
      `FIX: change scan.ts to pass toolChoice:'required' (with searchRecency:'oneWeek' ` +
      `for best coverage since oneDay adds no value when tool is actually firing).`
    );
  }

  if (bypassInABC && d.ok && d.searchCount === 0) {
    return (
      `tool_choice='required' accepted by API but DID NOT force tool use. ` +
      `D returned searchCount=0 just like A/B/C. The parameter is a silent ` +
      `no-op on z.ai's chat-completions endpoint. FIX: fall back to a prompt- ` +
      `layer hard rule.`
    );
  }

  // Fallback: cover the originally-envisaged cases
  if (a.searchCount === 0 && (b.searchCount > 0 || c.searchCount > 0)) {
    return (
      `search_recency_filter='oneDay' returned ZERO refs while oneWeek ` +
      `(${b.searchCount}) / noLimit (${c.searchCount}) returned refs. ` +
      `FIX: change scan.ts to searchRecency='oneWeek'.`
    );
  }

  return 'INCONCLUSIVE: unexpected result combination. Inspect all 4 cases manually.';
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

  console.log('[probe-scan-recency] starting 4-way comparison...');

  const results: CaseResult[] = [];
  const cases: Array<
    [CaseResult['label'], CaseResult['searchRecency'], CaseResult['toolChoice']]
  > = [
    ['A_oneDay', 'oneDay', 'auto'],
    ['B_oneWeek', 'oneWeek', 'auto'],
    ['C_noLimit', 'noLimit', 'auto'],
    ['D_oneWeek_toolRequired', 'oneWeek', 'required'],
  ];
  for (const [label, recency, toolChoice] of cases) {
    console.log(`[probe-scan-recency] ▶ ${label} (recency=${recency}, tool_choice=${toolChoice})...`);
    const r = await runOne(label, recency, toolChoice, apiKey);
    results.push(r);
    console.log(
      `[probe-scan-recency] ← ${r.ok ? 'OK' : 'FAIL'}  dur=${(r.durationMs / 1000).toFixed(1)}s  refs=${r.searchCount}  topics=${r.topicsCount}` +
        (r.errorMessage ? `  error=${r.errorMessage}` : '')
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
