import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { translateReportContent } from '@/lib/translate/translate-content';
import type { ReportContent } from '@/types/report';

/**
 * Async report content translation (zh <-> en).
 *
 * Triggered by `report/translate` events emitted from:
 *   - /api/reports/[id]/publish (auto after publish)
 *   - /api/admin/reports/[id]/re-translate (admin manual)
 *   - scripts/backfill-translations.ts (historical backfill)
 *
 * Idempotent: short-circuits when `content_translated` is already populated,
 * unless the event carries `force: true` (sent by the re-translate endpoint
 * after it clears the column).
 */
export const reportTranslate = inngest.createFunction(
  {
    id: 'report-translate',
    retries: 3,
    concurrency: { limit: 2 },
    triggers: [{ event: 'report/translate' }],
  },
  async ({ event, step }) => {
    const { reportId, force } = event.data as {
      reportId: string;
      force?: boolean;
    };

    // ── Step 1: fetch report ──
    const row = await step.run('fetch-report', async () => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from('reports')
        .select('id, content, content_translated')
        .eq('id', reportId)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`Fetch report failed: ${error.message}`);
      return data as {
        id: string;
        content: ReportContent;
        content_translated: ReportContent | null;
      } | null;
    });

    if (!row) {
      return { skipped: true, reason: 'report not found' };
    }
    if (!force && row.content_translated) {
      return { skipped: true, reason: 'already translated' };
    }
    if (!row.content) {
      return { skipped: true, reason: 'no content to translate' };
    }

    // ── Step 2: translate via OpenRouter ──
    const translated = await step.run('translate', () =>
      translateReportContent(row.content)
    );

    // ── Step 3: write back ──
    await step.run('write-back', async () => {
      const supabase = createServiceRoleClient();
      const { error } = await supabase
        .from('reports')
        .update({ content_translated: translated })
        .eq('id', reportId);
      if (error) throw new Error(`Write-back failed: ${error.message}`);
    });

    return { translated: true, reportId };
  }
);
