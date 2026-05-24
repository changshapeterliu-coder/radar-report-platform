import { scheduleTick } from './schedule-tick';
import { generateReport } from './generate-report';
import { dailyAlertTick } from './daily-alert-tick';
import { dailyAlertRun } from './daily-alert-run';
import { dailyAlertTranslateTopic } from './daily-alert-translate-topic';
import { dailyAlertTranslateCanonical } from './daily-alert-translate-canonical';
import { reportTranslate } from './report-translate';
import { newsTranslate } from './news-translate';
import { translationSweeper } from './translation-sweeper';

export {
  scheduleTick,
  generateReport,
  dailyAlertTick,
  dailyAlertRun,
  dailyAlertTranslateTopic,
  dailyAlertTranslateCanonical,
  reportTranslate,
  newsTranslate,
  translationSweeper,
};

/**
 * Aggregate array consumed by `src/app/api/inngest/route.ts` via `serve()`.
 * Add new Inngest functions to this list so Vercel's webhook registers them.
 *
 * After deploying a change to this list, perform a Resync in the Inngest
 * Cloud dashboard — Inngest caches function configuration server-side and
 * will not pick up new triggers / idempotency keys / concurrency limits
 * without an explicit Resync.
 */
export const functions = [
  scheduleTick,
  generateReport,
  // Daily hot-topic alert feature (spec: daily-hot-topic-alert)
  dailyAlertTick,
  dailyAlertRun,
  dailyAlertTranslateTopic,
  dailyAlertTranslateCanonical,
  // Unified content translation (reports + news)
  reportTranslate,
  newsTranslate,
  // Daily safety net for any row that missed its translate fan-out
  translationSweeper,
];
