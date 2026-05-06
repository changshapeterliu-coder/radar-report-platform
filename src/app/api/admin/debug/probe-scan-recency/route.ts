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
  label:
    | 'A_oneDay'
    | 'B_oneWeek'
    | 'C_noLimit'
    | 'D_oneWeek_toolRequired'
    | 'E_weeklyPromptReplay'
    | 'F_weeklyPromptDailyWindow_oneDay'
    | 'G_weeklyPromptDailyWindow_noLimit';
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
  apiKey: string,
  promptOverride?: string,
  contentSizeOverride?: 'low' | 'medium' | 'high'
): Promise<CaseResult> {
  const start = Date.now();
  const result = await callZai<{ topics?: unknown[] }>({
    model: 'glm-4.6',
    messages: [{ role: 'user', content: promptOverride ?? PROMPT }],
    apiKey,
    timeoutMs: 240_000,
    jsonMode: true,
    enableWebSearch: true,
    searchRecency,
    contentSize: contentSizeOverride ?? 'high',
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

  // topicsCount may come from {topics: [...]} (daily shape) OR from weekly's
  // {account_health_topics: [...], listing_topics: [...], tool_feedback_items: [...]}.
  // Sum all three if present so case E reflects "did weekly output anything at all".
  const data = result.data ?? {};
  const topicsList = Array.isArray(data.topics) ? data.topics.length : 0;
  const weeklyA = Array.isArray((data as Record<string, unknown>).account_health_topics)
    ? ((data as Record<string, unknown>).account_health_topics as unknown[]).length
    : 0;
  const weeklyB = Array.isArray((data as Record<string, unknown>).listing_topics)
    ? ((data as Record<string, unknown>).listing_topics as unknown[]).length
    : 0;
  const topicsCount = topicsList + weeklyA + weeklyB;

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

/**
 * Load the production weekly Engine B scan prompt from prompt_templates and
 * substitute the {start_date} / {end_date} / {week_label} placeholders with
 * the last 7-day window ending yesterday. Returns the resolved string, or
 * null if the prompt row can't be loaded (e.g. missing seed).
 */
async function loadAndResolveWeeklyEngineBPrompt(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string | null> {
  const { data: domainRows } = await supabase
    .from('domains')
    .select('id')
    .eq('name', 'Account Health')
    .limit(1);
  const domainId = domainRows?.[0]?.id;
  if (!domainId) return null;

  const { data: promptRows } = await supabase
    .from('prompt_templates')
    .select('template_text')
    .eq('domain_id', domainId)
    .eq('prompt_type', 'engine_b_hot_radar')
    .limit(1);
  const template = promptRows?.[0]?.template_text;
  if (!template || typeof template !== 'string') return null;

  // Compute last 7-day window ending yesterday (Shanghai-ish; for this probe
  // we don't need timezone precision, only rough placeholder values).
  const now = new Date();
  const endDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const startDate = new Date(endDate.getTime() - 6 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const weekLabel = `${fmt(startDate)} ~ ${fmt(endDate)}`;

  return template
    .split('{start_date}')
    .join(fmt(startDate))
    .split('{end_date}')
    .join(fmt(endDate))
    .split('{week_label}')
    .join(weekLabel);
}

/**
 * Same as loadAndResolveWeeklyEngineBPrompt, but substitutes a 24-hour
 * window (yesterday 00:00 → yesterday 23:59 Shanghai-ish) into the weekly
 * prompt's {start_date} / {end_date} / {week_label} placeholders.
 *
 * Used by probe cases F and G to test the hypothesis: does the weekly
 * Engine B prompt's structure/persona produce real Chinese-seller refs
 * even when we narrow the declared window to one day?
 *
 * Returns null if the weekly prompt row is missing in prompt_templates.
 */
async function loadAndResolveWeeklyPromptForDailyWindow(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string | null> {
  const { data: domainRows } = await supabase
    .from('domains')
    .select('id')
    .eq('name', 'Account Health')
    .limit(1);
  const domainId = domainRows?.[0]?.id;
  if (!domainId) return null;

  const { data: promptRows } = await supabase
    .from('prompt_templates')
    .select('template_text')
    .eq('domain_id', domainId)
    .eq('prompt_type', 'engine_b_hot_radar')
    .limit(1);
  const template = promptRows?.[0]?.template_text;
  if (!template || typeof template !== 'string') return null;

  // 24h window, yesterday. Shanghai-approximate (probe doesn't need tz
  // precision; we just want the prompt to say "yesterday, one day only").
  const now = new Date();
  const endDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const startDate = endDate; // same day as end — declare window as a single day
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  // Use the daily-style label so prompt context suggests "daily" not "weekly".
  const weekLabel = `daily-${fmt(endDate)}`;

  return template
    .split('{start_date}')
    .join(fmt(startDate))
    .split('{end_date}')
    .join(fmt(endDate))
    .split('{week_label}')
    .join(weekLabel);
}

function diagnose(results: CaseResult[]): string {
  const a = results.find((r) => r.label === 'A_oneDay');
  const b = results.find((r) => r.label === 'B_oneWeek');
  const c = results.find((r) => r.label === 'C_noLimit');
  const d = results.find((r) => r.label === 'D_oneWeek_toolRequired');
  const e = results.find((r) => r.label === 'E_weeklyPromptReplay');
  if (!a || !b || !c || !d) return 'inconclusive: missing case results';

  // Prior experiment (2026-05-03) confirmed:
  //   A/B/C all returned searchCount=0 + topicsCount=5 (hallucinated from training).
  //   D returned 400 Invalid parameter — z.ai doesn't accept tool_choice.
  // So the question reduces to: does GLM call web_search when given a
  // prompt structure that it *does* call on in weekly production (case E)?

  const dailyBypass =
    a.searchCount === 0 &&
    b.searchCount === 0 &&
    c.searchCount === 0 &&
    a.topicsCount > 0;

  if (dailyBypass && e) {
    if (!e.ok) {
      return (
        `Case E (weekly prompt replay) failed: ${e.errorMessage ?? '(no message)'}. ` +
        `Can't distinguish between "daily prompt triggers bypass" and "z.ai regression". ` +
        `Inspect the error manually.`
      );
    }
    if (e.searchCount > 0) {
      return (
        `ROOT CAUSE CONFIRMED: It's the daily prompt itself. Weekly production ` +
        `prompt triggered a real search (searchCount=${e.searchCount}, duration=${(e.durationMs / 1000).toFixed(1)}s) ` +
        `while daily prompts A/B/C bypassed search and hallucinated. The daily ` +
        `prompt is shorter/less anchored and doesn't signal GLM strongly enough ` +
        `that it *must* search. FIX: rewrite daily_scan_prompt closer to the ` +
        `weekly structure — explicit "使命 + {coverage_window} as first-class ` +
        `anchor", 具体渠道清单 first-class section, and remove any hints that ` +
        `could read as "你可以不搜". Test again with the revised prompt.`
      );
    }
    return (
      `SYSTEMIC: Even the weekly production prompt returned searchCount=0 ` +
      `on z.ai today (topicsCount=${e.topicsCount}, duration=${(e.durationMs / 1000).toFixed(1)}s). ` +
      `This is NOT a daily-prompt problem — it's a z.ai service-level regression ` +
      `or upstream issue. Check: recent z.ai status page, any silent API deprecation ` +
      `announcement, or recent ZAI_API_KEY quota change. Before changing any prompt, ` +
      `verify the last successful weekly production run's scheduled_runs.kimi_output ` +
      `searchReferences.length.`
    );
  }

  if (dailyBypass && !d.ok) {
    return (
      `tool_choice='required' REJECTED by z.ai (${d.errorMessage ?? '(no message)'}). ` +
      `The API layer cannot force tool use. Check case E result to decide next step.`
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

  return 'INCONCLUSIVE: unexpected result combination. Inspect all cases manually.';
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

  console.log('[probe-scan-recency] starting 5-way comparison...');

  const weeklyPrompt = await loadAndResolveWeeklyEngineBPrompt(supabase);
  if (weeklyPrompt == null) {
    console.warn('[probe-scan-recency] Could not load weekly engine_b_hot_radar prompt; case E will be skipped');
  }

  const weeklyPromptDailyWindow =
    await loadAndResolveWeeklyPromptForDailyWindow(supabase);
  if (weeklyPromptDailyWindow == null) {
    console.warn(
      '[probe-scan-recency] Could not load weekly engine_b_hot_radar prompt; cases F/G will be skipped'
    );
  }

  const results: CaseResult[] = [];
  const cases: Array<{
    label: CaseResult['label'];
    recency: CaseResult['searchRecency'];
    toolChoice: CaseResult['toolChoice'];
    promptOverride?: string;
    contentSizeOverride?: 'low' | 'medium' | 'high';
  }> = [
    { label: 'A_oneDay', recency: 'oneDay', toolChoice: 'auto' },
    { label: 'B_oneWeek', recency: 'oneWeek', toolChoice: 'auto' },
    { label: 'C_noLimit', recency: 'noLimit', toolChoice: 'auto' },
    { label: 'D_oneWeek_toolRequired', recency: 'oneWeek', toolChoice: 'required' },
  ];
  if (weeklyPrompt) {
    cases.push({
      label: 'E_weeklyPromptReplay',
      recency: 'oneWeek',
      toolChoice: 'auto',
      promptOverride: weeklyPrompt,
      contentSizeOverride: 'medium', // matches weekly production loop.ts config
    });
  }
  // F / G: weekly prompt structure + daily 24h window substitution.
  // Hypothesis: the weekly prompt's richer persona ("情报研究员", explicit
  // data-source precedence, search-strategy paragraph) drives GLM to actually
  // search Chinese seller sites, regardless of recency filter. We test both
  // oneDay and noLimit with the same prompt to isolate recency effect under
  // the weekly structure.
  if (weeklyPromptDailyWindow) {
    cases.push({
      label: 'F_weeklyPromptDailyWindow_oneDay',
      recency: 'oneDay',
      toolChoice: 'auto',
      promptOverride: weeklyPromptDailyWindow,
      contentSizeOverride: 'medium',
    });
    cases.push({
      label: 'G_weeklyPromptDailyWindow_noLimit',
      recency: 'noLimit',
      toolChoice: 'auto',
      promptOverride: weeklyPromptDailyWindow,
      contentSizeOverride: 'medium',
    });
  }

  for (const c of cases) {
    console.log(
      `[probe-scan-recency] ▶ ${c.label} (recency=${c.recency}, tool_choice=${c.toolChoice}${c.promptOverride ? ', prompt=weekly-production' : ''})...`
    );
    const r = await runOne(
      c.label,
      c.recency,
      c.toolChoice,
      apiKey,
      c.promptOverride,
      c.contentSizeOverride
    );
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
