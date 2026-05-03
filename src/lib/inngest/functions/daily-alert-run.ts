import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { runDailyScan } from '@/lib/daily-alert/scan';
import { runDailyCanonicalize } from '@/lib/daily-alert/canonicalize';
import {
  persistDailyAlertTransaction,
  persistEmptyDayAlert,
  loadAllTopicCanonicalsForDomain,
} from '@/lib/daily-alert/persist';
import type { CanonicalAssignment } from '@/types/daily-alert';

/**
 * Daily-alert main orchestrator.
 *
 * Triggers:
 *   - event `daily-alert/scheduled-trigger` (from `daily-alert-tick`)
 *   - event `daily-alert/manual-trigger`    (from admin UI button)
 *
 * Step sequence:
 *   1. insert-run-row       (DB unique constraint → dedupe; duplicate exits gracefully)
 *   2. fetch-config         (domain name + 2 prompts + env-var fail-fast)
 *   3. scan                 (GLM-4.6 scan, 5min step timeout)
 *   4a. persist-empty-day   (branch: scan returned 0 topics → publish Empty_Day_Alert)
 *   4b. load-canonicals → canonicalize → persist   (branch: scan returned ≥1 topic)
 *   5. enqueue-translations (fan-out: per-topic + per-new-canonical events)
 *   6. finalize-run (mark succeeded)
 *
 * Failure path at any step:
 *   - finalize as 'failed' with scoped `failure_reason` substring (per design §失败处理矩阵)
 *   - notify all admins
 *
 * NEVER writes to: `news`, `scheduled_runs`, `reports` (Req 16.6 / PBT 16).
 *
 * Spec refs:
 *   Requirements: 2.x, 3.x, 4.x, 6.x, 7.x, 9.x, 13.3, 13.4, 14.2, 16.6
 *   Design:       §组件与接口 §2 `daily-alert-run.ts`
 */

type TriggerEventData = {
  domainId: string;
  triggerType: 'scheduled' | 'manual';
  coverageWindowStartDate: string; // 'YYYY-MM-DD' Shanghai
  coverageWindowStartIso: string;
  coverageWindowEndIso: string;
};

export const dailyAlertRun = inngest.createFunction(
  {
    id: 'daily-alert-run',
    retries: 0, // per-step retries managed inside scan/canon via callZai
    // NOTE: function-level idempotency intentionally omitted. Uniqueness per
    // (domain, coverage_date) is enforced by the DB partial unique index on
    // daily_alert_runs (status IN 'queued','running','succeeded') + the active-
    // runs check in the manual-trigger API route. Function-level idempotency
    // would block legitimate retries after failure.
    concurrency: { limit: 3 },
    triggers: [
      { event: 'daily-alert/scheduled-trigger' },
      { event: 'daily-alert/manual-trigger' },
    ],
  },
  async ({ event, step }) => {
    const eventData = event.data as TriggerEventData;
    const {
      domainId,
      triggerType,
      coverageWindowStartDate,
      coverageWindowStartIso,
      coverageWindowEndIso,
    } = eventData;

    // ── Env-var fail-fast (before touching DB) ──
    const zaiApiKey = process.env.ZAI_API_KEY ?? '';
    if (!zaiApiKey) {
      // Create a failed run row so admins can see it in /admin/daily-alert-runs
      // and get the notification breadcrumb.
      const failedRunId = await step.run('create-run-row-missing-key', async () => {
        const supabase = createServiceRoleClient();
        const { data, error } = await supabase
          .from('daily_alert_runs')
          .insert({
            domain_id: domainId,
            trigger_type: triggerType,
            status: 'failed',
            coverage_window_start_date: coverageWindowStartDate,
            coverage_window_start: coverageWindowStartIso,
            coverage_window_end: coverageWindowEndIso,
            failure_reason: 'ZAI_API_KEY missing',
            completed_at: new Date().toISOString(),
          })
          .select('id')
          .limit(1);
        if (error) {
          // If DB insert itself fails, there's nothing we can do — Inngest
          // retry budget is 0 and we don't want to loop. Throw so the run
          // is visible as a function-level failure in Inngest dashboard.
          throw new Error(`Failed to insert ZAI_API_KEY-missing run: ${error.message}`);
        }
        return (data?.[0]?.id as string) ?? null;
      });

      if (failedRunId) {
        await step.run('notify-admins-missing-key', () =>
          notifyAdminsOfFailure(domainId, failedRunId, 'ZAI_API_KEY missing', coverageWindowStartDate)
        );
      }
      return { skipped: true, reason: 'ZAI_API_KEY missing' };
    }

    // ── Step 1: Insert daily_alert_runs row (status=running) ──
    const runIdOrNull = await step.run('insert-run-row', async () => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from('daily_alert_runs')
        .insert({
          domain_id: domainId,
          trigger_type: triggerType,
          status: 'running',
          coverage_window_start_date: coverageWindowStartDate,
          coverage_window_start: coverageWindowStartIso,
          coverage_window_end: coverageWindowEndIso,
        })
        .select('id')
        .limit(1);
      if (error) {
        // Postgres unique violation → another active run already holds the slot
        // for (domain_id, coverage_window_start_date) via partial unique index.
        if (error.code === '23505') {
          console.log(
            `[daily-alert-run] Duplicate run for ${domainId} @ ${coverageWindowStartDate}; exiting gracefully.`
          );
          return null;
        }
        throw new Error(`Failed to insert daily_alert_runs: ${error.message}`);
      }
      if (!data || data.length === 0) {
        throw new Error('daily_alert_runs insert returned no row');
      }
      return data[0].id as string;
    });

    if (runIdOrNull === null) {
      return { skipped: true, reason: 'duplicate-run' };
    }
    const runId: string = runIdOrNull;

    // ── Step 2: Fetch config (domain name + 2 daily prompts) ──
    const config = await step.run('fetch-config', async () => {
      const supabase = createServiceRoleClient();

      const [domainRes, promptsRes] = await Promise.all([
        supabase.from('domains').select('name').eq('id', domainId).limit(1),
        supabase
          .from('prompt_templates')
          .select('prompt_type, template_text')
          .eq('domain_id', domainId)
          .in('prompt_type', ['daily_scan_prompt', 'daily_canonicalization_prompt']),
      ]);

      if (domainRes.error) {
        throw new Error(`Failed to fetch domain: ${domainRes.error.message}`);
      }
      if (!domainRes.data || domainRes.data.length === 0) {
        throw new Error(`Domain ${domainId} not found`);
      }
      if (promptsRes.error) {
        throw new Error(`Failed to fetch daily prompts: ${promptsRes.error.message}`);
      }

      const byType: Record<string, string> = {};
      for (const row of promptsRes.data ?? []) {
        byType[row.prompt_type as string] = row.template_text as string;
      }
      const scanPrompt = byType['daily_scan_prompt'];
      const canonPrompt = byType['daily_canonicalization_prompt'];
      if (!scanPrompt || !canonPrompt) {
        throw new Error(
          `Missing daily prompts for domain ${domainId}: need daily_scan_prompt + daily_canonicalization_prompt`
        );
      }

      return {
        domainName: domainRes.data[0].name as string,
        scanPrompt,
        canonPrompt,
      };
    });

    // ── Step 3: Scan ──
    // Network timeout enforced inside callZai (240s per scan.ts). Step-level
    // timeout is left at Inngest default (2h), which is safely above scan budget.
    const scanResult = await step.run(
      'scan',
      async () =>
        runDailyScan({
          scanPrompt: config.scanPrompt,
          domainName: config.domainName,
          coverageWindowStartIso,
          coverageWindowEndIso,
          zaiApiKey,
          runId,
        })
    );

    if (!scanResult.ok) {
      await finalizeAsFailed(step, domainId, runId, scanResult.failureReason, scanResult.rawOutput, coverageWindowStartDate);
      return { runId, status: 'failed' as const, failureReason: scanResult.failureReason };
    }

    // ── Step 4a: Empty-day branch (skip canonicalize + translate) ──
    if (scanResult.topics.length === 0) {
      await step.run('persist-empty-day', () =>
        persistEmptyDayAlert({
          runId,
          domainId,
          coverageWindowStartDate,
        })
      );

      await step.run('mark-succeeded-empty', async () => {
        const supabase = createServiceRoleClient();
        const { error } = await supabase
          .from('daily_alert_runs')
          .update({
            status: 'succeeded',
            topic_count: 0,
            new_canonical_count: 0,
            completed_at: new Date().toISOString(),
          })
          .eq('id', runId);
        if (error) {
          throw new Error(`Failed to mark empty-day run succeeded: ${error.message}`);
        }
      });

      return { runId, status: 'succeeded' as const, topicCount: 0, newCanonicalCount: 0 };
    }

    // ── Step 4b: Full path — load canonicals → canonicalize → persist ──
    const existingCanonicals = await step.run('load-canonicals', () =>
      loadAllTopicCanonicalsForDomain(domainId)
    );
    const existingKeys = new Set(existingCanonicals.map((c) => c.canonical_topic_key));

    const canonResult = await step.run(
      'canonicalize',
      async () =>
        runDailyCanonicalize({
          canonPrompt: config.canonPrompt,
          scannedTopics: scanResult.topics,
          existingCanonicals,
          domainName: config.domainName,
          zaiApiKey,
          runId,
        })
    );

    if (!canonResult.ok) {
      // Req 9.9 / PBT 15: NO half-persist — entire run fails.
      await finalizeAsFailed(step, domainId, runId, canonResult.failureReason, canonResult.rawOutput, coverageWindowStartDate);
      return { runId, status: 'failed' as const, failureReason: canonResult.failureReason };
    }

    // Re-derive is_new_canonical from DB state (novelty.ts rule): trust the
    // existingKeys Set, not the AI's self-report. This is a defense-in-depth
    // that also correctly handles the race where a concurrent run minted
    // the key between `load-canonicals` and `canonicalize`.
    const truedAssignments: CanonicalAssignment[] = canonResult.assignments.map((a) => ({
      ...a,
      is_new_canonical: !existingKeys.has(a.canonical_topic_key),
    })) as CanonicalAssignment[];

    const persistResult = await step.run('persist', () =>
      persistDailyAlertTransaction({
        runId,
        domainId,
        coverageWindowStartDate,
        scannedTopics: scanResult.topics,
        canonicalAssignments: truedAssignments,
        existingCanonicalKeys: existingKeys,
      })
    );

    // ── Step 5: Enqueue async translation jobs ──
    await step.run('enqueue-translations', async () => {
      const events: Array<{ name: string; data: Record<string, unknown> }> = [];
      for (const topicId of persistResult.topicIds) {
        events.push({
          name: 'daily-alert/translate-topic',
          data: { topicId, domainId },
        });
      }
      for (const key of persistResult.newCanonicalKeys) {
        events.push({
          name: 'daily-alert/translate-canonical',
          data: { domainId, canonicalTopicKey: key },
        });
      }
      if (events.length > 0) {
        // inngest.send accepts an array of events.
        await inngest.send(events as Parameters<typeof inngest.send>[0]);
      }
      return { enqueued: events.length };
    });

    // ── Step 6: Mark run succeeded ──
    await step.run('mark-succeeded', async () => {
      const supabase = createServiceRoleClient();
      const { error } = await supabase
        .from('daily_alert_runs')
        .update({
          status: 'succeeded',
          topic_count: scanResult.topics.length,
          new_canonical_count: persistResult.newCanonicalKeys.length,
          completed_at: new Date().toISOString(),
        })
        .eq('id', runId);
      if (error) {
        throw new Error(`Failed to mark daily-alert-run succeeded: ${error.message}`);
      }
    });

    return {
      runId,
      status: 'succeeded' as const,
      topicCount: scanResult.topics.length,
      newCanonicalCount: persistResult.newCanonicalKeys.length,
    };
  }
);

// ══════════ Helpers ══════════

/**
 * Mark the run as `failed` + fire admin notifications. Called for every
 * failure branch to keep logic consistent across scan / canonicalize /
 * persist failures.
 *
 * The `step` parameter is typed loosely because Inngest SDK v4's step-context
 * type uses `Jsonify<T>` wrappers that are not easily reused. In practice the
 * only two methods we need are `.run(name, fn)` returning void — a structural
 * type matches that narrow shape.
 */
type MinimalStep = {
  run: (name: string, fn: () => Promise<unknown>) => Promise<unknown>;
};

async function finalizeAsFailed(
  step: MinimalStep,
  domainId: string,
  runId: string,
  failureReason: string,
  rawOutput: string,
  coverageWindowStartDate: string
): Promise<void> {
  await step.run('mark-failed', async () => {
    const supabase = createServiceRoleClient();
    const { error } = await supabase
      .from('daily_alert_runs')
      .update({
        status: 'failed',
        failure_reason: failureReason,
        raw_output: rawOutput.slice(0, 500),
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId);
    if (error) {
      throw new Error(`Failed to mark run as failed: ${error.message}`);
    }
  });

  await step.run('notify-admins-failure', () =>
    notifyAdminsOfFailure(domainId, runId, failureReason, coverageWindowStartDate)
  );
}

/**
 * Fan-out failure notifications to every user with role='admin'.
 *
 * Reuses `type='news'` enum value per task 1.4 V1 decision (no new enum
 * value introduced). The `reference_id=runId` + `summary` contain the
 * routing + diagnostic info needed by the admin UI to deep-link into the
 * run history page.
 */
async function notifyAdminsOfFailure(
  domainId: string,
  runId: string,
  failureReason: string,
  coverageWindowStartDate: string
): Promise<{ notified: number }> {
  const supabase = createServiceRoleClient();

  const { data: admins, error: adminErr } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'admin');
  if (adminErr) {
    throw new Error(`Failed to list admins for daily-alert failure notify: ${adminErr.message}`);
  }
  if (!admins || admins.length === 0) return { notified: 0 };

  const title = `Daily alert run failed · ${coverageWindowStartDate}`;
  const summary = failureReason.slice(0, 400);

  const rows = admins.map((a) => ({
    user_id: a.id as string,
    domain_id: domainId,
    type: 'news' as const, // Reused per task 1.4; future P2 task 11.3 may add 'daily_alert_failure'.
    title,
    summary,
    reference_id: runId,
  }));

  const { error: notifErr } = await supabase.from('notifications').insert(rows);
  if (notifErr) {
    throw new Error(`Failed to insert daily-alert failure notifications: ${notifErr.message}`);
  }
  return { notified: rows.length };
}
