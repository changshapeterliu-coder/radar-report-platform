import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import {
  computeCoverageWindow,
  shouldFire,
  type ScheduleConfigTickInput,
} from '@/lib/inngest/coverage-window';
import { buildIdempotencyKey } from '@/lib/inngest/idempotency';

/**
 * Schedule tick function.
 *
 * Runs once per minute in Asia/Shanghai time. For each enabled
 * `schedule_configs` row whose `day_of_week` + `time_of_day` matches the current
 * Shanghai minute, enqueues a `report/generate.requested` event with a
 * deterministic event `id` so Inngest dedupes duplicate ticks within the same
 * minute. The DB `scheduled_runs` partial unique index provides a second layer
 * of idempotency protection downstream.
 *
 * We intentionally set `retries: 0` — missing one minute is recoverable on the
 * next tick; retrying a missed minute risks firing the same event at a
 * confusing moment in time.
 */
export const scheduleTick = inngest.createFunction(
  {
    id: 'schedule-tick',
    retries: 0,
    triggers: [{ cron: 'TZ=Asia/Shanghai * * * * *' }],
  },
  async ({ step }) => {
    const now = new Date();

    const configs = await step.run('fetch-enabled-configs', async () => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from('schedule_configs')
        .select('domain_id, enabled, cadence, day_of_week, time_of_day')
        .eq('enabled', true);
      if (error) {
        throw new Error(`Failed to fetch schedule_configs: ${error.message}`);
      }
      return data ?? [];
    });

    for (const config of configs) {
      const tickInput: ScheduleConfigTickInput = {
        enabled: config.enabled,
        day_of_week: config.day_of_week,
        time_of_day: config.time_of_day,
      };
      if (!shouldFire(tickInput, now)) continue;

      const coverageWindow = computeCoverageWindow(now, config.cadence);
      await step.sendEvent('enqueue-generate', {
        name: 'report/generate.requested',
        // Deterministic event id → Inngest event-level dedupe within the
        // short retention window. Same key as DB idempotency.
        id: buildIdempotencyKey(config.domain_id, coverageWindow.startIso),
        data: {
          domainId: config.domain_id,
          triggerType: 'scheduled',
          coverageWindowStart: coverageWindow.startIso,
          coverageWindowEnd: coverageWindow.endIso,
          weekLabel: coverageWindow.weekLabel,
        },
      });
    }
  }
);
