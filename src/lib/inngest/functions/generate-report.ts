import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { runGeminiLoop } from '@/lib/research-engine/engines/gemini';
import { runKimiLoop } from '@/lib/research-engine/engines/kimi';
import type { StageRunner } from '@/lib/research-engine/engines/loop';
import { synthesize } from '@/lib/research-engine/synthesizer';
import type { ReportContent } from '@/types/report';
import type {
  CoverageWindow,
  EngineError,
  InngestGenerateReportEvent,
} from '@/types/scheduled-runs';
import { determineStatus, buildFailureReason } from './determine-status';

const MODULE_TITLES = [
  'Account Suspension Trends',
  'Listing Takedown Trends',
  'Account Health Tool Feedback',
  'Education Opportunities',
] as const;

/**
 * Main orchestrator for dual-engine scheduled draft generation.
 *
 * Step sequence (names mirror the design § "Step 命名规范" table):
 *   1. insert-run-row
 *   2. fetch-config
 *   3. engine-{gemini,kimi}-stage{1..5}   (run in parallel at the top level)
 *   4. synthesize                         (only if ≥1 engine succeeded)
 *   5. create-draft
 *   6. finalize-run
 *   7. notify-admins
 *
 * Retries = 0 at the function level; each step inherits Inngest defaults
 * (3 retries) unless overridden via the loop's stage-specific options.
 *
 * Idempotency: the `idempotency` option dedupes events in Inngest's short
 * retention window; the DB partial unique index on scheduled_runs provides the
 * durable second layer.
 */
export const generateReport = inngest.createFunction(
  {
    id: 'generate-report',
    retries: 0,
    // NOTE: function-level idempotency intentionally omitted. Uniqueness per
    // (domain, coverage_window) is enforced by the DB partial unique index
    // on scheduled_runs (status IN 'queued','running','succeeded') + the
    // activeRuns check in trigger/retry API routes. A function-level
    // idempotency key here would block legitimate retries after failure.
    concurrency: { limit: 5 },
    triggers: [{ event: 'report/generate.requested' }],
  },
  async ({ event, step }) => {
    const {
      domainId,
      triggerType,
      coverageWindowStart,
      coverageWindowEnd,
      weekLabel,
    } = event.data as InngestGenerateReportEvent;

    const coverageWindow: CoverageWindow = {
      startIso: coverageWindowStart,
      endIso: coverageWindowEnd,
      weekLabel,
    };
    const triggeredAt = new Date();

    // ── Step 1: Insert scheduled_runs row (status=running) ──
    // Partial unique index on (domain_id, coverage_window_start) WHERE status
    // IN ('queued','running','succeeded') enforces idempotency at the DB
    // layer. If someone else already has a live run for this window, we exit
    // gracefully without starting any engine work.
    const runIdOrNull = await step.run('insert-run-row', async () => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from('scheduled_runs')
        .insert({
          domain_id: domainId,
          trigger_type: triggerType,
          status: 'running',
          coverage_window_start: coverageWindowStart,
          coverage_window_end: coverageWindowEnd,
          week_label: weekLabel,
          triggered_at: triggeredAt.toISOString(),
        })
        .select('id')
        .limit(1);
      if (error) {
        // Postgres unique violation → another run already holds the slot.
        if (error.code === '23505') {
          console.log(
            `[generate-report] Duplicate run for ${domainId} @ ${coverageWindowStart}; exiting gracefully.`
          );
          return null;
        }
        throw new Error(`Failed to insert scheduled_runs: ${error.message}`);
      }
      if (!data || data.length === 0) {
        throw new Error('scheduled_runs insert returned no row');
      }
      return data[0].id as string;
    });

    if (runIdOrNull === null) {
      return { skipped: true, reason: 'duplicate-run' };
    }
    const runId: string = runIdOrNull;

    // ── Step 2: Fetch domain name + 3 admin-editable prompts ──
    const config = await step.run('fetch-config', async () => {
      const supabase = createServiceRoleClient();

      const [domainRes, promptsRes] = await Promise.all([
        supabase.from('domains').select('name').eq('id', domainId).limit(1),
        supabase
          .from('prompt_templates')
          .select('prompt_type, template_text')
          .eq('domain_id', domainId),
      ]);

      if (domainRes.error) {
        throw new Error(`Failed to fetch domain: ${domainRes.error.message}`);
      }
      if (!domainRes.data || domainRes.data.length === 0) {
        throw new Error(`Domain ${domainId} not found`);
      }
      if (promptsRes.error) {
        throw new Error(`Failed to fetch prompt_templates: ${promptsRes.error.message}`);
      }

      const byType: Record<string, string> = {};
      for (const row of promptsRes.data ?? []) {
        byType[row.prompt_type] = row.template_text;
      }
      const geminiPrompt = byType['gemini_prompt'];
      const kimiPrompt = byType['kimi_prompt'];
      const synthesizerPrompt = byType['synthesizer_prompt'];
      if (!geminiPrompt || !kimiPrompt || !synthesizerPrompt) {
        throw new Error(
          `Missing prompt_templates for domain ${domainId}: need gemini_prompt, kimi_prompt, synthesizer_prompt`
        );
      }

      const openRouterApiKey = process.env.OPENROUTER_API_KEY;
      if (!openRouterApiKey) {
        throw new Error('OPENROUTER_API_KEY is not set');
      }

      return {
        domainName: domainRes.data[0].name as string,
        geminiPrompt,
        kimiPrompt,
        synthesizerPrompt,
        openRouterApiKey,
      };
    });

    // ── Steps 3 & 4: Run both engine loops in parallel. ──
    // Each loop internally dispatches 5 stages as independent Inngest steps
    // via the injected stageRunner. Keeping this shape keeps the
    // research-engine module free of inngest imports (Property 13).
    const geminiStageRunner: StageRunner = <T>(
      stage: string,
      fn: () => Promise<T>
    ) => step.run(`engine-gemini-${stage}`, fn) as Promise<T>;
    const kimiStageRunner: StageRunner = <T>(
      stage: string,
      fn: () => Promise<T>
    ) => step.run(`engine-kimi-${stage}`, fn) as Promise<T>;

    const [geminiLoop, kimiLoop] = await Promise.all([
      runGeminiLoop(
        {
          coverageWindow,
          domainName: config.domainName,
          geminiPrompt: config.geminiPrompt,
          openRouterApiKey: config.openRouterApiKey,
          maxSubquestionsPerRound: 8,
          maxGapSubquestions: 4,
        },
        geminiStageRunner
      ),
      runKimiLoop(
        {
          coverageWindow,
          domainName: config.domainName,
          kimiPrompt: config.kimiPrompt,
          openRouterApiKey: config.openRouterApiKey,
          maxSubquestionsPerRound: 8,
          maxGapSubquestions: 4,
        },
        kimiStageRunner
      ),
    ]);

    // ── Step 5: Synthesize (only if ≥1 engine produced a non-null summary) ──
    let content: ReportContent | null = null;
    let synthError: EngineError | null = null;
    if (geminiLoop.summary !== null || kimiLoop.summary !== null) {
      const synthResult = await step.run('synthesize', async () =>
        synthesize({
          geminiSummary: geminiLoop.summary,
          kimiSummary: kimiLoop.summary,
          synthesizerPrompt: config.synthesizerPrompt,
          coverageWindow,
          openRouterApiKey: config.openRouterApiKey,
          timeoutMs: 3 * 60_000,
        })
      );
      if (synthResult.ok) {
        content = synthResult.content;
      } else {
        synthError = synthResult.error;
      }
    }

    // ── Step 6: Create draft row (Skeleton_Draft fallback when content null) ──
    const draftId = await step.run('create-draft', async () => {
      const supabase = createServiceRoleClient();

      // Scheduled runs have no user session — fall back to any admin as author.
      const { data: admins, error: adminErr } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin')
        .limit(1);
      if (adminErr) {
        throw new Error(`Failed to find admin author: ${adminErr.message}`);
      }
      if (!admins || admins.length === 0) {
        throw new Error(
          'No admin profile found; cannot assign created_by for scheduled draft'
        );
      }

      const finalContent: ReportContent =
        content ?? buildSkeletonDraft(weekLabel, coverageWindowStart, coverageWindowEnd);

      const { data, error } = await supabase
        .from('reports')
        .insert({
          domain_id: domainId,
          created_by: admins[0].id as string,
          title: `Account Health Radar Report - ${weekLabel}`,
          type: 'regular',
          date_range: `${coverageWindowStart} ~ ${coverageWindowEnd}`,
          week_label: weekLabel,
          status: 'draft',
          content: finalContent,
        })
        .select('id')
        .limit(1);
      if (error) {
        throw new Error(`Failed to insert draft report: ${error.message}`);
      }
      if (!data || data.length === 0) {
        throw new Error('Draft report insert returned no row');
      }
      return data[0].id as string;
    });

    // ── Step 7: Finalize scheduled_runs row ──
    const allErrors: EngineError[] = [
      ...geminiLoop.errors,
      ...kimiLoop.errors,
      ...(synthError ? [synthError] : []),
    ];
    const finalStatus = determineStatus(
      geminiLoop.summary !== null,
      kimiLoop.summary !== null,
      content !== null
    );
    const failureReason = buildFailureReason(allErrors);

    await step.run('finalize-run', async () => {
      const supabase = createServiceRoleClient();
      const completedAt = new Date();
      const { error } = await supabase
        .from('scheduled_runs')
        .update({
          status: finalStatus,
          draft_report_id: draftId,
          failure_reason: failureReason,
          gemini_output: geminiLoop.trace as unknown,
          kimi_output: kimiLoop.trace as unknown,
          synthesizer_output: content as unknown,
          duration_ms: completedAt.getTime() - triggeredAt.getTime(),
          completed_at: completedAt.toISOString(),
        })
        .eq('id', runId);
      if (error) {
        throw new Error(`Failed to finalize scheduled_run: ${error.message}`);
      }
    });

    // ── Step 8: Notify all admins ──
    await step.run('notify-admins', async () => {
      const supabase = createServiceRoleClient();
      const { data: admins, error: adminErr } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin');
      if (adminErr) {
        throw new Error(`Failed to list admins for notification: ${adminErr.message}`);
      }
      if (!admins || admins.length === 0) return { notified: 0 };

      const isSuccess = finalStatus === 'succeeded';
      const title = isSuccess
        ? `Scheduled draft ready: ${weekLabel}`
        : `Scheduled run ${finalStatus}: ${weekLabel}`;
      const summary = isSuccess
        ? 'Review and publish'
        : failureReason ?? 'Unknown error';
      const referenceId = isSuccess ? draftId : runId;

      const rows = admins.map((a) => ({
        user_id: a.id as string,
        domain_id: domainId,
        type: 'report' as const,
        title,
        summary,
        reference_id: referenceId,
      }));

      const { error: notifErr } = await supabase.from('notifications').insert(rows);
      if (notifErr) {
        throw new Error(`Failed to insert notifications: ${notifErr.message}`);
      }
      return { notified: rows.length };
    });

    return { runId, draftId, finalStatus };
  }
);

/**
 * Builds an empty-shell ReportContent when no synthesized content is available.
 * Four fixed module titles in fixed order; every array empty. The Admin can
 * still open the draft, see the skeleton, and manually author content —
 * satisfying Requirement 7.1 (system always produces a draft row).
 */
function buildSkeletonDraft(
  weekLabel: string,
  startIso: string,
  endIso: string
): ReportContent {
  return {
    title: `Account Health Radar Report - ${weekLabel}`,
    dateRange: `${startIso} ~ ${endIso}`,
    modules: MODULE_TITLES.map((title) => ({
      title,
      blocks: [],
      tables: [],
      analysisSections: [],
      highlightBoxes: [],
    })),
  };
}
