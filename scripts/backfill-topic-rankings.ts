/**
 * Backfill — re-run weekly canonicalize → persist for one or more
 * already-published reports. Mirrors the publish route's
 * `runCanonicalizeBlock` (`src/app/api/reports/[id]/publish/route.ts`)
 * exactly: same prompt, same engine, same persist RPC, same translate
 * fan-out shape.
 *
 * Why this exists:
 *   When the publish route changes shape (this spec replaces the legacy
 *   ad-hoc `extractAndPersistTopicRankings` with the shared canonicalize
 *   flow), reports published BEFORE the new code rolled out have stale
 *   `topic_rankings` rows tied to the old `topic_label` shape. This
 *   script rewrites those rows under the new `canonical_topic_key`
 *   shape so the dashboard / `/reports/[id]` Category column renders
 *   correctly across the historical window (W17, W19, ...).
 *
 * What this script DOES:
 *   1. SELECT report row by id.
 *   2. Load shared canonicalize prompt + domain name + existing
 *      `topic_canonicals` for the report's domain.
 *   3. Run `runWeeklyCanonicalize` per module (0 / 1).
 *   4. True-up `is_new_canonical` against the loaded dictionary (the LLM
 *      sometimes claims a key is new when the dictionary already has it,
 *      or vice versa — trust the DB snapshot).
 *   5. Call `persistWeeklyTopicRankings` — atomic in one TXN inside
 *      the RPC body: DELETE prior `topic_rankings` rows for this
 *      report → UPSERT canonicals (`ON CONFLICT DO NOTHING`) → INSERT
 *      new `topic_rankings` rows.
 *   6. Enqueue `daily-alert/translate-canonical` per minted key, with
 *      try/catch per event so a single Inngest hiccup doesn't fail
 *      the whole report.
 *
 * What this script DELIBERATELY DOES NOT DO (Req 12.6):
 *   - It NEVER touches `reports.status`.
 *   - It NEVER touches `reports.content`.
 *   - It NEVER touches `reports.published_at`.
 *   The publish-state lifecycle is owned by the publish route alone.
 *
 * Idempotence (Req 12.5):
 *   By construction. The persist RPC always DELETEs prior rows for the
 *   report before INSERTing new ones, and `topic_canonicals` is guarded
 *   by `(domain_id, canonical_topic_key) ON CONFLICT DO NOTHING`. Two
 *   sequential runs against the same report produce the same row set
 *   and the same dictionary count.
 *
 * CLI shape (Req 12.1):
 *   npm run backfill:topic-rankings -- --report=<id>
 *   npm run backfill:topic-rankings -- --report=<id> --report=<id>
 *
 *   Legacy `--force` and `--domain` flags are REMOVED. `--report` is
 *   the only supported mode.
 *
 * Exit code:
 *   0 — every report processed successfully.
 *   1 — at least one report failed (other reports still attempted).
 *
 * Env (auto-loaded from .env.local via `--env-file` in the npm script):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - OPENROUTER_API_KEY
 *   - INNGEST_EVENT_KEY (only needed if translate fan-out should reach prod)
 *
 * Spec refs:
 *   Requirements: 12.1, 12.2, 12.5, 12.6
 *   Design:       §`scripts/backfill-topic-rankings.ts` — REFACTOR
 */

import { createServiceRoleClient } from '../src/lib/supabase/service-role';
import { inngest } from '../src/lib/inngest/client';
import { buildScannedTopicsFromModule } from '../src/lib/topic-rankings/scan';
import {
  applyDictionaryTrueUp,
  buildPerModuleAssignments,
  runWeeklyCanonicalize,
} from '../src/lib/topic-rankings/canonicalize';
import { persistWeeklyTopicRankings } from '../src/lib/topic-rankings/persist';
import { loadAllTopicCanonicalsForDomain } from '../src/lib/daily-alert/persist';
import type {
  CanonicalAssignment,
  ScanTopic,
} from '../src/lib/topic-rankings/zod-schemas';
import type { ReportContent } from '../src/types/report';

// ══════════ CLI parsing ══════════

interface ParsedArgs {
  reportIds: string[];
  removedFlags: string[];
}

function parseArgs(): ParsedArgs {
  const reportIds: string[] = [];
  const removedFlags: string[] = [];

  for (const raw of process.argv.slice(2)) {
    if (!raw.startsWith('--')) continue;

    const eqIdx = raw.indexOf('=');
    const flag = eqIdx === -1 ? raw.slice(2) : raw.slice(2, eqIdx);
    const value = eqIdx === -1 ? '' : raw.slice(eqIdx + 1);

    if (flag === 'report') {
      if (value) reportIds.push(value);
      continue;
    }

    // Reject the legacy flags loudly (Req 12.1 — `--report` is the only mode).
    if (flag === 'force' || flag === 'domain') {
      removedFlags.push(`--${flag}`);
      continue;
    }
  }

  return { reportIds, removedFlags };
}

function printUsageAndExit(extra?: string): never {
  if (extra) console.error(extra);
  console.error(
    'Usage:\n' +
      '  npm run backfill:topic-rankings -- --report=<id>\n' +
      '  npm run backfill:topic-rankings -- --report=<id> --report=<id>\n' +
      '\n' +
      'Each --report runs canonicalize → persist → translate fan-out for\n' +
      'that report. The script never modifies reports.status / .content /\n' +
      '.published_at.'
  );
  process.exit(1);
}

// ══════════ Per-report processing ══════════

interface ReportRow {
  id: string;
  domain_id: string;
  week_label: string | null;
  content: ReportContent | null;
}

type ProcessResult =
  | { ok: true; inserted: number; newCanonicals: number; reusedCanonicals: number; dropped: number }
  | { ok: false; reason: string };

async function processReport(reportId: string): Promise<ProcessResult> {
  console.log(`[backfill ${reportId}] starting`);

  const apiKey = process.env.OPENROUTER_API_KEY ?? '';
  if (!apiKey) {
    return {
      ok: false,
      reason: 'weekly canonicalize: provider API key missing OPENROUTER_API_KEY',
    };
  }

  const supabase = createServiceRoleClient();

  // 1. SELECT the report row (read only — never mutate reports per Req 12.6).
  const { data: reportData, error: reportErr } = await supabase
    .from('reports')
    .select('id, domain_id, week_label, content')
    .eq('id', reportId)
    .limit(1)
    .maybeSingle();

  if (reportErr) {
    return { ok: false, reason: `report load failed: ${reportErr.message}` };
  }
  if (!reportData) {
    return { ok: false, reason: 'report not found' };
  }

  const report = reportData as ReportRow;
  const content = report.content;
  if (!content || !content.modules?.length) {
    return { ok: false, reason: 'report.content has no modules' };
  }

  // 2. Count existing topic_rankings rows. The persist RPC deletes them
  //    inside its TXN body (delete-then-insert is atomic), so we sample
  //    the count BEFORE persist to log it as "dropped" — purely for
  //    operator telemetry; correctness is not gated on this number.
  const { count: priorCount, error: priorErr } = await supabase
    .from('topic_rankings')
    .select('id', { count: 'exact', head: true })
    .eq('report_id', reportId);

  if (priorErr) {
    return { ok: false, reason: `prior count query failed: ${priorErr.message}` };
  }
  const dropped = priorCount ?? 0;
  console.log(
    `[backfill ${reportId}] dropped=${dropped} (existing topic_rankings rows; will be replaced atomically)`
  );

  // 3. Load shared canonicalize prompt + domain name + existing dictionary.
  const [promptRes, domainRes] = await Promise.all([
    supabase
      .from('prompt_templates')
      .select('id, template_text')
      .eq('domain_id', report.domain_id)
      .eq('prompt_type', 'daily_canonicalization_prompt')
      .limit(1)
      .maybeSingle(),
    supabase
      .from('domains')
      .select('name')
      .eq('id', report.domain_id)
      .limit(1)
      .maybeSingle(),
  ]);

  if (promptRes.error) {
    return { ok: false, reason: `prompt load failed: ${promptRes.error.message}` };
  }
  if (!promptRes.data) {
    return {
      ok: false,
      reason: `daily_canonicalization_prompt missing for domain ${report.domain_id}`,
    };
  }
  const promptRow = promptRes.data;
  const domainName = domainRes.data?.name ?? '';

  let existingCanonicals: Awaited<ReturnType<typeof loadAllTopicCanonicalsForDomain>>;
  try {
    existingCanonicals = await loadAllTopicCanonicalsForDomain(report.domain_id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `dictionary load failed: ${msg}` };
  }
  const existingCanonicalKeys = new Set(
    existingCanonicals.map((c) => c.canonical_topic_key)
  );

  // 4. Run canonicalize per module. Sequentially, mirroring the publish
  //    route, so per-module drop logs aren't interleaved.
  const moduleIndices = [0, 1] as const;
  const scannedTopicsByModule: Record<number, ScanTopic[]> = {};
  const assignmentsByModule: Record<number, CanonicalAssignment[]> = {};

  for (const moduleIndex of moduleIndices) {
    const scanned = buildScannedTopicsFromModule(content, moduleIndex);
    scannedTopicsByModule[moduleIndex] = scanned;

    if (scanned.length === 0) {
      assignmentsByModule[moduleIndex] = [];
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
      return {
        ok: false,
        reason: `${result.failureReason} | raw_output="${result.rawOutput}"`,
      };
    }

    if (result.droppedAssignments.length > 0) {
      console.warn(
        `[backfill ${reportId}] module ${moduleIndex} canonicalize dropped ${result.droppedAssignments.length} of ${scanned.length} topics`
      );
    }

    // True-up `is_new_canonical` against the dictionary snapshot we
    // already loaded, AND defend against hallucinated reuse. Four
    // quadrants handled by `applyDictionaryTrueUp`:
    //   1. new+notInDict  → unchanged (RPC will INSERT)
    //   2. new+inDict     → flip to false (RPC will skip, bump seen_count)
    //   3. reuse+inDict   → unchanged
    //   4. reuse+notInDict → SYNTHETIC DROP (engine hallucinated reuse;
    //      flipping to new would crash the RPC on the canonical_title_zh
    //      NOT NULL constraint).
    // The persist RPC validates length(assignments) == length(scanned_topics)
    // per module — pass kept + dropped sorted by scanned_topic_index so
    // parity is preserved (was: only `keptAssignments`, which caused the
    // "module 0 length mismatch topics=5 assignments=4" backfill error).
    const truedKept = applyDictionaryTrueUp({
      assignments: result.keptAssignments,
      existingCanonicalKeys,
      reportId,
    });
    const truedKeptOnly = truedKept.filter((a) => a.decision === 'keep');
    const hallucinatedDrops = truedKept.filter((a) => a.decision === 'drop');

    assignmentsByModule[moduleIndex] = buildPerModuleAssignments({
      keptAssignments: truedKeptOnly,
      droppedAssignments: [...result.droppedAssignments, ...hallucinatedDrops],
    });
  }

  // 5. Atomic persist (DELETE prior + UPSERT canonicals + INSERT new) —
  //    handled entirely inside `persist_weekly_topic_rankings` PL/pgSQL.
  let persistResult: Awaited<ReturnType<typeof persistWeeklyTopicRankings>>;
  try {
    persistResult = await persistWeeklyTopicRankings({
      supabase,
      reportId,
      domainId: report.domain_id,
      weekLabel: report.week_label,
      scannedTopicsByModule,
      assignmentsByModule,
      existingCanonicalKeys,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg };
  }

  // 6. Translate fan-out — one event per minted canonical. Per-event
  //    try/catch so a single Inngest enqueue hiccup doesn't fail the
  //    whole report (mirrors the publish route).
  for (const key of persistResult.newCanonicalKeys) {
    try {
      await inngest.send({
        name: 'daily-alert/translate-canonical',
        data: { domainId: report.domain_id, canonicalTopicKey: key },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[backfill ${reportId}] translate enqueue failed for ${key}: ${msg}`
      );
    }
  }

  return {
    ok: true,
    inserted: persistResult.inserted,
    newCanonicals: persistResult.newCanonicalKeys.length,
    reusedCanonicals: persistResult.reusedCanonicalKeys.length,
    dropped,
  };
}

// ══════════ Main ══════════

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.removedFlags.length > 0) {
    printUsageAndExit(
      `Removed flags detected: ${args.removedFlags.join(', ')}.\n` +
        `These flags were dropped — the only supported mode is per-report ids.\n`
    );
  }

  if (args.reportIds.length === 0) {
    printUsageAndExit('No --report=<id> flags provided.\n');
  }

  console.log(
    `Processing ${args.reportIds.length} report(s) sequentially: ${args.reportIds.join(', ')}\n`
  );

  let failures = 0;

  for (const reportId of args.reportIds) {
    const result = await processReport(reportId);

    if (result.ok) {
      console.log(
        `[backfill ${reportId}] success inserted=${result.inserted} ` +
          `newCanonicals=${result.newCanonicals} ` +
          `reusedCanonicals=${result.reusedCanonicals} ` +
          `dropped=${result.dropped}\n`
      );
    } else {
      failures++;
      console.error(
        `[backfill ${reportId}] failure_reason="${result.reason}"\n`
      );
    }
  }

  console.log(
    `Done. processed=${args.reportIds.length} failed=${failures}`
  );

  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
