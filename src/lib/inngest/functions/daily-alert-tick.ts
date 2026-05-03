import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import {
  toShanghai,
  computeCoverageDate,
  computeCoverageWindowIso,
  shouldFire,
} from '@/lib/daily-alert/coverage-window';
import type { DailyAlertConfigRow } from '@/types/daily-alert';

/**
 * Daily-alert schedule tick.
 *
 * Runs once per minute in Asia/Shanghai time. For each enabled
 * `daily_alert_configs` row whose `time_of_day` matches the current Shanghai
 * HH:MM, enqueues a `daily-alert/scheduled-trigger` event with a deterministic
 * event `id` so Inngest dedupes duplicate ticks within the same minute. The
 * partial unique index on `daily_alert_runs(domain_id, coverage_window_start_date)`
 * provides the durable second layer of idempotency (see migration 015).
 *
 * Mirrors the weekly `schedule-tick.ts` structure but:
 *   - Only matches on `time_of_day` (no `day_of_week`, daily fires every day)
 *   - Coverage window = previous Asia/Shanghai calendar day 00:00–23:59
 *   - Writes to `daily_alert_*` tables only — zero interaction with
 *     `schedule_configs` / `scheduled_runs` / `news` / `reports`.
 *
 * Spec refs:
 *   Requirements: 1.6, 2.1, 2.2, 2.3, 15.1, 15.2
 *   Design:       §组件与接口 §2 `daily-alert-tick.ts`
 */
export const dailyAlertTick = inngest.createFunction(
  {
    id: 'daily-alert-tick',
    retries: 0,
    triggers: [{ cron: 'TZ=Asia/Shanghai * * * * *' }],
  },
  async ({ step }) => {
    const now = new Date();
    const nowShanghai = toShanghai(now);

    const configs = await step.run('fetch-enabled-daily-configs', async () => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from('daily_alert_configs')
        .select('id, domain_id, enabled, time_of_day, timezone, created_at, updated_at')
        .eq('enabled', true);
      if (error) {
        throw new Error(`Failed to fetch daily_alert_configs: ${error.message}`);
      }
      return (data ?? []) as DailyAlertConfigRow[];
    });

    for (const config of configs) {
      if (!shouldFire(config, nowShanghai)) continue;

      const coverageDate = computeCoverageDate(nowShanghai);
      const { startIso, endIso } = computeCoverageWindowIso(coverageDate);

      await step.sendEvent('enqueue-scheduled-daily-run', {
        name: 'daily-alert/scheduled-trigger',
        // Deterministic event id → Inngest event-level dedupe within the
        // retention window. DB partial unique index is the durable layer.
        id: `daily-alert:${config.domain_id}:${coverageDate}`,
        data: {
          domainId: config.domain_id,
          triggerType: 'scheduled' as const,
          coverageWindowStartDate: coverageDate,
          coverageWindowStartIso: startIso,
          coverageWindowEndIso: endIso,
        },
      });
    }
  }
);
