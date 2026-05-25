import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { inngest } from '@/lib/inngest/client';
import { buildScannedTopicsFromModule } from '@/lib/topic-rankings/scan';
import {
  applyDictionaryTrueUp,
  buildPerModuleAssignments,
  runWeeklyCanonicalize,
} from '@/lib/topic-rankings/canonicalize';
import { persistWeeklyTopicRankings } from '@/lib/topic-rankings/persist';
import { loadAllTopicCanonicalsForDomain } from '@/lib/daily-alert/persist';
import type {
  CanonicalAssignment,
  ScanTopic,
} from '@/lib/topic-rankings/zod-schemas';
import type { ReportContent } from '@/types/report';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PUT /api/reports/[id]/publish
 *
 * Marks the draft report as `status='published'`, then runs the topic-
 * rankings canonicalize → persist flow per the design "Error Handling"
 * section of the `unify-topic-dictionary-across-pipelines` spec.
 *
 * Contract (Req 7.3 / Req 13.5 / Req 14.1):
 *   - Always returns HTTP 200 with `data: report` once the reports row
 *     update succeeded. The canonicalize block is fully gated by its own
 *     try/catch — failures NEVER cascade to the response.
 *   - `reports.content` is never mutated (Req 7.1). The canonical
 *     classification lives in `topic_rankings` + `topic_canonicals`,
 *     not inside the report body.
 *
 * Telemetry (Req 11.x):
 *   - `[publish ${id}] canonicalize starting ...` at block start
 *   - `[publish ${id}] failure_reason="..." raw_output="..."` on every
 *     named failure mode (provider key missing, prompt missing, dictionary
 *     load failed, canonicalize failed, persist failed, FK violation)
 *   - `[publish ${id}] module N dropped K of N topics` per module
 *   - `[publish ${id}] dropped topic_name="..." drop_reason="..."` per drop
 *   - `[publish ${id}] inserted=N dropped=M newCanonicals=K reusedCanonicals=R` on success
 *
 * Translate fan-out (Req 16.1 / 16.4):
 *   - One `daily-alert/translate-canonical` Inngest event per minted key
 *   - Per-event try/catch: enqueue failure logs warn but does NOT abort
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      { status: 401 }
    );
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 },
      { status: 403 }
    );
  }

  // Update report status to published
  const now = new Date().toISOString();
  const { data: report, error: updateError } = await supabase
    .from('reports')
    .update({ status: 'published', published_at: now })
    .eq('id', id)
    .select()
    .single();

  if (updateError) {
    if (updateError.code === 'PGRST116') {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Report not found', statusCode: 404 },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { code: 'UPDATE_ERROR', message: updateError.message, statusCode: 500 },
      { status: 500 }
    );
  }

  // Enqueue async translation via Inngest. The `report-translate` function
  // reads the row, calls OpenRouter with retry, and writes `content_translated`
  // back. Non-blocking — publish returns immediately; failures are retried by
  // Inngest and recoverable via the admin "Re-translate" button.
  if (report.content) {
    try {
      await inngest.send({
        name: 'report/translate',
        data: { reportId: id },
      });
    } catch (err) {
      // Inngest enqueue failure should NOT block publish. Log so the
      // operator can spot a quiet Inngest outage.
      console.warn(
        `[publish ${id}] report-translate enqueue failed (non-blocking): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // ── Topic-rankings canonicalize → persist (PR-C) ─────────────
  // Wrapped so any unexpected throw inside the block (including from
  // helpers we don't directly catch) terminates at a single console.error
  // and never blocks publish — outer catch is the Req 11.6 backstop
  // ("no silent canonicalize failure"). The block itself never throws on
  // expected failure modes; it returns early after a structured log line.
  try {
    await runCanonicalizeBlock(id, report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[publish ${id}] canonicalize block failed (non-blocking outer catch): ${msg}`
    );
  }

  // ── AI-generated Hitting News based on topic ranking changes ─
  // Reads via the new join shape: `topic_rankings.canonical_topic_key`
  // joined to `topic_canonicals` for the human-readable title. The legacy
  // `topic_label` column is still dual-written by the RPC for the
  // dashboard's transitional fallback, but new code reads the canonical
  // title (Spec ref: Req 10 / design `select('canonical_topic_key, ...')`).
  try {
    const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
    if (OPENROUTER_KEY) {
      const { data: allRankings } = await supabase
        .from('topic_rankings')
        .select(
          'rank, week_label, canonical_topic_key, topic_canonicals!inner(canonical_title_zh, canonical_title_en)'
        )
        .eq('domain_id', report.domain_id)
        .eq('module_index', 0)
        .not('canonical_topic_key', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50);

      type AiInsightRow = {
        rank: number;
        week_label: string | null;
        canonical_topic_key: string | null;
        topic_canonicals:
          | { canonical_title_zh: string; canonical_title_en: string | null }
          | { canonical_title_zh: string; canonical_title_en: string | null }[]
          | null;
      };

      const rows = (allRankings ?? []) as AiInsightRow[];
      if (rows.length > 0) {
        // Group by week. Use the canonical Chinese title as the topic
        // label fed to the news prompt — stable across weeks because the
        // dictionary entry is shared by definition.
        const byWeek = new Map<
          string,
          Array<{ topic_label: string; rank: number }>
        >();
        for (const r of rows) {
          const tc = Array.isArray(r.topic_canonicals)
            ? r.topic_canonicals[0]
            : r.topic_canonicals;
          if (!tc) continue;
          const w = r.week_label || 'Unknown';
          if (!byWeek.has(w)) byWeek.set(w, []);
          byWeek
            .get(w)!
            .push({ topic_label: tc.canonical_title_zh, rank: r.rank });
        }

        const weeksData = Array.from(byWeek.entries()).map(([week, topics]) => ({
          week,
          topics,
        }));

        const newsPrompt = `你是亚马逊卖家账户健康情报平台的专业新闻编辑。分析各周话题排名变化，生成值得关注的新闻条目。

按周排名（最新在前）：
${JSON.stringify(weeksData.slice(0, 5), null, 2)}

围绕以下变化生成 1-3 条新闻：
- 新进入排名的话题
- 排名显著上升的话题
- 连续多周保持 #1 的话题

每条新闻用专业但抓人眼球的新闻语气，包含一个有冲击力的标题和 1-2 句话的摘要。

**重要：所有 title / summary / content 字段都用中文输出。** 平台后续会通过另一条独立 pipeline 自动翻译成英文 — 你只负责中文版本。

Return JSON: { "news": [{ "title": "中文标题", "summary": "1-2 句中文摘要", "content": "2-3 段中文正文" }] }

如果没有显著变化（例如只有一周数据），返回 { "news": [] }。
仅返回合法 JSON。`;

        const newsRes = await fetch(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${OPENROUTER_KEY}`,
            },
            body: JSON.stringify({
              model: 'openrouter/auto',
              messages: [
                {
                  role: 'system',
                  content: '你是新闻编辑。仅返回合法 JSON，所有内容字段使用中文。',
                },
                { role: 'user', content: newsPrompt },
              ],
              response_format: { type: 'json_object' },
            }),
          }
        );

        if (newsRes.ok) {
          const newsData = await newsRes.json();
          const parsed = JSON.parse(
            newsData?.choices?.[0]?.message?.content || '{}'
          );
          const newsItems = parsed.news || [];

          for (const item of newsItems) {
            if (item.title && item.content) {
              const { data: insertedNews, error: insertErr } = await supabase
                .from('news')
                .insert({
                  domain_id: report.domain_id,
                  created_by: user.id,
                  title: item.title,
                  summary: item.summary || null,
                  content: item.content,
                  source_channel: 'AI Insight',
                  is_pinned: false,
                })
                .select('id')
                .single();

              if (insertErr || !insertedNews?.id) {
                console.warn(
                  `[publish ${id}] AI Insight news insert failed (non-blocking): ${insertErr?.message ?? 'no id returned'}`
                );
                continue;
              }

              // Enqueue translation so AI Insight news shows up bilingual
              // like every other news row. Mirrors /api/news POST. Bug
              // pre-fix: AI Insight rows never carried `content_translated`
              // because this enqueue was missing — they always rendered as
              // Chinese-original on en mode.
              try {
                await inngest.send({
                  name: 'news/translate',
                  data: { newsId: insertedNews.id },
                });
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.warn(
                  `[publish ${id}] AI Insight translate enqueue failed for ${insertedNews.id} (non-blocking): ${msg}`
                );
              }
            }
          }
        } else {
          console.warn(
            `[publish ${id}] AI Insight news http=${newsRes.status} (non-blocking)`
          );
        }
      }
    }
  } catch (err) {
    // AI news generation failure should NOT block publish — but log loudly
    // (Req 11.6: never empty-catch).
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[publish ${id}] AI Insight news failed (non-blocking): ${msg}`);
  }

  // Create notifications for all team_members in this domain
  const { data: teamMembers, error: membersError } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'team_member');

  if (membersError) {
    // Report was published but notifications failed — return success with warning
    return NextResponse.json({
      data: report,
      warning: 'Report published but failed to create notifications',
    });
  }

  if (teamMembers && teamMembers.length > 0) {
    const notifications = teamMembers.map((member) => ({
      user_id: member.id,
      domain_id: report.domain_id,
      type: 'report' as const,
      title: report.title,
      reference_id: report.id,
    }));

    const { error: notifError } = await supabase
      .from('notifications')
      .insert(notifications);

    if (notifError) {
      return NextResponse.json({
        data: report,
        warning: 'Report published but failed to create some notifications',
      });
    }
  }

  return NextResponse.json({ data: report });
}

// ════════════════════════════════════════════════════════════════
// runCanonicalizeBlock
// ════════════════════════════════════════════════════════════════
//
// Mirrors the design "Error Handling" section. Each named failure mode
// terminates at exactly one structured log line and an early `return` —
// nothing throws out of this block on an expected failure (Req 11.6).
//
// All DB I/O inside this block runs through the service-role client:
//   1. The persist RPC is `GRANT EXECUTE ... TO service_role` only
//      (migration 026b). An authenticated client returns "permission
//      denied" before the body even runs.
//   2. `prompt_templates` and `topic_canonicals` reads stay consistent
//      with the daily-alert pipeline, which already uses service-role
//      end-to-end (`src/lib/inngest/functions/daily-alert-run.ts`).

interface PublishedReportRow {
  id: string;
  domain_id: string;
  week_label: string | null;
  content: ReportContent | null;
}

async function runCanonicalizeBlock(
  reportId: string,
  report: PublishedReportRow
): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? '';

  // 1. Provider API key (Req 13.4)
  if (!apiKey) {
    logError(
      reportId,
      'weekly canonicalize: provider API key missing OPENROUTER_API_KEY'
    );
    return;
  }

  const reportContent = report.content;
  if (!reportContent || !reportContent.modules?.length) {
    // Not a failure mode per the spec — the report just has nothing to
    // canonicalize. Log as warn so an empty `topic_rankings` is observable.
    console.warn(
      `[publish ${reportId}] report.content has no modules — skipping canonicalize`
    );
    return;
  }

  const serviceRoleClient = createServiceRoleClient();

  // 2. Load the shared `daily_canonicalization_prompt` row + domain name.
  //    Both pipelines read the same prompt_type — that's the whole point
  //    of this spec (Req 1.1 / 1.2 / 1.3).
  const [promptRes, domainRes] = await Promise.all([
    serviceRoleClient
      .from('prompt_templates')
      .select('id, template_text')
      .eq('domain_id', report.domain_id)
      .eq('prompt_type', 'daily_canonicalization_prompt')
      .limit(1)
      .maybeSingle(),
    serviceRoleClient
      .from('domains')
      .select('name')
      .eq('id', report.domain_id)
      .limit(1)
      .maybeSingle(),
  ]);

  if (promptRes.error) {
    logError(
      reportId,
      `weekly canonicalize: prompt load failed: ${promptRes.error.message}`
    );
    return;
  }
  // Req 1.5: explicit failure_reason phrase.
  if (!promptRes.data) {
    logError(
      reportId,
      `daily_canonicalization_prompt missing for domain ${report.domain_id}`
    );
    return;
  }
  const promptRow = promptRes.data;
  const domainName = domainRes.data?.name ?? '';

  // 3. Load the existing dictionary for this domain. No `origin` filter —
  //    both pipelines share the dictionary by design (Req 2.1).
  let existingCanonicals: Awaited<
    ReturnType<typeof loadAllTopicCanonicalsForDomain>
  >;
  try {
    existingCanonicals = await loadAllTopicCanonicalsForDomain(report.domain_id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(reportId, `weekly canonicalize: dictionary load failed: ${msg}`);
    return;
  }
  const existingCanonicalKeys = new Set(
    existingCanonicals.map((c) => c.canonical_topic_key)
  );

  // Count scanned topics across all modules — used in the start-of-block
  // log line per Req 11.1.
  const moduleIndices = [0, 1] as const;
  const scannedByModule = new Map<number, ScanTopic[]>();
  let totalScanned = 0;
  for (const moduleIndex of moduleIndices) {
    const scanned = buildScannedTopicsFromModule(reportContent, moduleIndex);
    scannedByModule.set(moduleIndex, scanned);
    totalScanned += scanned.length;
  }

  console.log(
    `[publish ${reportId}] canonicalize starting reportId=${reportId} ` +
      `domainId=${report.domain_id} promptTemplateId=${promptRow.id} ` +
      `scannedTopicsCount=${totalScanned}`
  );

  // 4. Per-module canonicalize. Run sequentially to keep log lines
  //    interleaved per module (parallel would scramble drop-per-topic
  //    breadcrumbs across modules and confuse operators).
  const perModuleResults: Array<{
    moduleIndex: number;
    scanned: ScanTopic[];
    assignments: CanonicalAssignment[];
  }> = [];
  let totalDropped = 0;

  for (const moduleIndex of moduleIndices) {
    const scanned = scannedByModule.get(moduleIndex) ?? [];
    if (scanned.length === 0) {
      perModuleResults.push({ moduleIndex, scanned: [], assignments: [] });
      continue;
    }

    const result = await runWeeklyCanonicalize({
      canonPrompt: promptRow.template_text,
      scannedTopics: scanned,
      existingCanonicals,
      domainName,
      openRouterApiKey: apiKey,
      reportId,
    });

    if (!result.ok) {
      // Failure-reason already prefixed by canonicalize.ts (Req 13.1-13.4).
      logError(reportId, result.failureReason, result.rawOutput);
      return;
    }

    // Drop-per-topic + drop-summary telemetry (Req 11.4).
    if (result.droppedAssignments.length > 0) {
      console.warn(
        `[publish ${reportId}] module ${moduleIndex} dropped ` +
          `${result.droppedAssignments.length} of ${scanned.length} topics`
      );
      for (const drop of result.droppedAssignments) {
        const topic = scanned[drop.scanned_topic_index];
        const topicName = topic?.topic_name_zh ?? '<unknown>';
        const reason = drop.decision === 'drop' ? drop.drop_reason : '';
        console.info(
          `[publish ${reportId}] dropped scanned_topic_index=${drop.scanned_topic_index} ` +
            `topic_name="${topicName}" drop_reason="${reason}"`
        );
      }
      totalDropped += result.droppedAssignments.length;
    }

    // Re-derive `is_new_canonical` against the loaded dictionary AND
    // defend against hallucinated reuse. Four quadrants handled by
    // `applyDictionaryTrueUp`:
    //   1. new+notInDict  → unchanged (RPC will INSERT)
    //   2. new+inDict     → flip to false (RPC will skip INSERT, bump seen_count)
    //   3. reuse+inDict   → unchanged
    //   4. reuse+notInDict → SYNTHETIC DROP (engine hallucinated reuse;
    //      flipping to new would crash the RPC on the canonical_title_zh
    //      NOT NULL constraint because the engine never populated it).
    // The RPC validates length(assignments) == length(scanned_topics)
    // per module — pass kept + dropped sorted by scanned_topic_index so
    // parity is preserved (this is what fixed the
    // "module 0 length mismatch topics=5 assignments=4" backfill error).
    const truedKept = applyDictionaryTrueUp({
      assignments: result.keptAssignments,
      existingCanonicalKeys,
      reportId,
    });
    // The true-up may have demoted some keeps into drops (quadrant 4),
    // so split again before concatenating with the engine's drops.
    const truedKeptOnly = truedKept.filter((a) => a.decision === 'keep');
    const hallucinatedDrops = truedKept.filter((a) => a.decision === 'drop');
    const moduleAssignments = buildPerModuleAssignments({
      keptAssignments: truedKeptOnly,
      droppedAssignments: [...result.droppedAssignments, ...hallucinatedDrops],
    });

    // Update telemetry counter to include hallucinated drops surfaced
    // by the true-up — they're real drops from the operator's perspective.
    if (hallucinatedDrops.length > 0) {
      totalDropped += hallucinatedDrops.length;
    }

    perModuleResults.push({
      moduleIndex,
      scanned,
      assignments: moduleAssignments,
    });
  }

  // 5. Atomic persist across both modules. The RPC wraps DELETE prior
  //    rows + UPSERT canonicals + INSERT new topic_rankings in one TXN
  //    (Req 14.3 / 15.1 / 15.2).
  const scannedTopicsByModule: Record<number, ScanTopic[]> = {};
  const assignmentsByModule: Record<number, CanonicalAssignment[]> = {};
  for (const r of perModuleResults) {
    scannedTopicsByModule[r.moduleIndex] = r.scanned;
    assignmentsByModule[r.moduleIndex] = r.assignments;
  }

  let persistResult: Awaited<ReturnType<typeof persistWeeklyTopicRankings>>;
  try {
    persistResult = await persistWeeklyTopicRankings({
      supabase: serviceRoleClient,
      reportId,
      domainId: report.domain_id,
      weekLabel: report.week_label,
      scannedTopicsByModule,
      assignmentsByModule,
      existingCanonicalKeys,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // FK violation can happen if a concurrent write pruned a canonical
    // between our load and our INSERT. Refresh the dictionary and retry
    // exactly once (Req 14.2).
    if (/foreign key/i.test(msg)) {
      try {
        const refreshed = await loadAllTopicCanonicalsForDomain(report.domain_id);
        const refreshedKeys = new Set(
          refreshed.map((c) => c.canonical_topic_key)
        );
        // Re-run the four-quadrant true-up against the fresh snapshot.
        // This may demote additional keeps into hallucinated-reuse
        // synthetic drops; rebuild the per-module sorted array each time
        // to keep length(assignments) == length(scanned_topics).
        const refreshedAssignments: Record<number, CanonicalAssignment[]> = {};
        for (const [k, list] of Object.entries(assignmentsByModule)) {
          const trued = applyDictionaryTrueUp({
            assignments: list,
            existingCanonicalKeys: refreshedKeys,
            reportId,
          });
          const keptOnly = trued.filter((a) => a.decision === 'keep');
          const allDrops = trued.filter((a) => a.decision === 'drop');
          refreshedAssignments[Number(k)] = buildPerModuleAssignments({
            keptAssignments: keptOnly,
            droppedAssignments: allDrops,
          });
        }
        persistResult = await persistWeeklyTopicRankings({
          supabase: serviceRoleClient,
          reportId,
          domainId: report.domain_id,
          weekLabel: report.week_label,
          scannedTopicsByModule,
          assignmentsByModule: refreshedAssignments,
          existingCanonicalKeys: refreshedKeys,
        });
      } catch (err2) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2);
        logError(reportId, `weekly canonicalize: FK violation on insert: ${msg2}`);
        return;
      }
    } else {
      // TXN rolled back — no half-persisted state visible to readers.
      logError(reportId, `weekly canonicalize: persistence failed: ${msg}`);
      return;
    }
  }

  // 6. Success line (Req 11.5).
  console.log(
    `[publish ${reportId}] inserted=${persistResult.inserted} ` +
      `dropped=${totalDropped} ` +
      `newCanonicals=${persistResult.newCanonicalKeys.length} ` +
      `reusedCanonicals=${persistResult.reusedCanonicalKeys.length} ` +
      `reportId=${reportId}`
  );

  // 7. Translate fan-out for newly minted canonicals (Req 16.1 / 16.4).
  //    One event per key. Per-event try/catch: enqueue failure logs warn
  //    but does NOT abort — the rest of the publish flow already shipped.
  for (const key of persistResult.newCanonicalKeys) {
    try {
      await inngest.send({
        name: 'daily-alert/translate-canonical',
        data: { domainId: report.domain_id, canonicalTopicKey: key },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[publish ${reportId}] translate enqueue failed for ${key}: ${msg}`
      );
    }
  }
}

/**
 * Best-effort error logger for the canonicalize block.
 *
 * Wraps `console.error` in its own try/catch because Req 7.3's last
 * sentence says: "IF the failure-logging itself fails (e.g. log infra
 * outage), THEN THE System SHALL still leave the report published —
 * the audit trail of the failure is best-effort, never a gate on
 * publish state." This is the ONE place an empty `catch {}` is allowed
 * — the logger itself is the audit trail; nothing else can record its
 * own failure.
 */
function logError(reportId: string, msg: string, rawOutput?: string): void {
  try {
    const truncated =
      rawOutput && rawOutput.length > 500
        ? `${rawOutput.slice(0, 500)}...`
        : rawOutput ?? '';
    console.error(
      `[publish ${reportId}] failure_reason="${msg}" raw_output="${truncated}"`
    );
  } catch {
    // Logger itself failed — swallow per Req 7.3. Never block publish on
    // a logging failure.
  }
}
