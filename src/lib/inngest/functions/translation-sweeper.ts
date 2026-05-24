import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

/**
 * Translation Sweeper — daily safety net.
 *
 * Scans every nullable bilingual surface for rows that did not get
 * translated for any reason (Inngest enqueue dropped, transient outage,
 * code path missed the fan-out, manual SQL insert, …) and fires a
 * translate event per row.
 *
 * Surfaces covered:
 *   1. `news.content_translated` IS NULL or empty → `news/translate`
 *   2. `topic_canonicals.canonical_title_en` IS NULL or empty
 *      → `daily-alert/translate-canonical`
 *   3. `reports.content_translated` IS NULL → `report/translate`
 *
 * Idempotent. The downstream translate functions short-circuit when the
 * target field is already populated, so re-runs are cheap.
 *
 * Schedule: 03:00 Asia/Shanghai daily — quiet hour, well after the
 * weekly publish window. Pick a time that does not collide with the
 * daily-alert-tick (which runs every minute anyway).
 *
 * Why not a Vercel cron:
 *   The project already has a Vercel cron for `/api/_health` and
 *   prefers Inngest for anything that needs retries + structured logs.
 *   Translation back-pressure may queue thousands of events on first
 *   run; Inngest's concurrency limits on the translate functions handle
 *   that gracefully.
 */
export const translationSweeper = inngest.createFunction(
  {
    id: 'translation-sweeper',
    retries: 1,
    triggers: [{ cron: 'TZ=Asia/Shanghai 0 3 * * *' }],
  },
  async ({ step, logger }) => {
    const supabase = createServiceRoleClient();

    // ── 1. News rows missing content_translated ──
    // content_translated is JSONB — only IS NULL is meaningful (the empty
    // JSON cases {} / [] are valid translations and we never produce them).
    const newsRows = await step.run('scan-news', async () => {
      const { data, error } = await supabase
        .from('news')
        .select('id')
        .is('content_translated', null);
      if (error) throw new Error(`news scan failed: ${error.message}`);
      return data ?? [];
    });

    let newsQueued = 0;
    for (const row of newsRows) {
      try {
        await inngest.send({
          name: 'news/translate',
          data: { newsId: row.id },
        });
        newsQueued++;
      } catch (e) {
        logger.warn(
          `[translation-sweeper] news enqueue failed for ${row.id}: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    }

    // ── 2. Canonicals missing canonical_title_en ──
    const canonRows = await step.run('scan-canonicals', async () => {
      const { data, error } = await supabase
        .from('topic_canonicals')
        .select('domain_id, canonical_topic_key')
        .or('canonical_title_en.is.null,canonical_title_en.eq.');
      if (error) throw new Error(`canonicals scan failed: ${error.message}`);
      return data ?? [];
    });

    let canonQueued = 0;
    for (const row of canonRows) {
      try {
        await inngest.send({
          name: 'daily-alert/translate-canonical',
          data: {
            domainId: row.domain_id,
            canonicalTopicKey: row.canonical_topic_key,
          },
        });
        canonQueued++;
      } catch (e) {
        logger.warn(
          `[translation-sweeper] canonical enqueue failed for ${row.canonical_topic_key}: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    }

    // ── 3. Reports missing content_translated ──
    const reportRows = await step.run('scan-reports', async () => {
      const { data, error } = await supabase
        .from('reports')
        .select('id')
        .eq('status', 'published')
        .is('content_translated', null);
      if (error) throw new Error(`reports scan failed: ${error.message}`);
      return data ?? [];
    });

    let reportQueued = 0;
    for (const row of reportRows) {
      try {
        await inngest.send({
          name: 'report/translate',
          data: { reportId: row.id },
        });
        reportQueued++;
      } catch (e) {
        logger.warn(
          `[translation-sweeper] report enqueue failed for ${row.id}: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    }

    return {
      newsScanned: newsRows.length,
      canonScanned: canonRows.length,
      reportScanned: reportRows.length,
      newsQueued,
      canonQueued,
      reportQueued,
    };
  }
);
