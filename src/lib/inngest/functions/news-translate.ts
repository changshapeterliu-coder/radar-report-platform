import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { translateNewsContent } from '@/lib/translate/translate-content';

/**
 * Async news content translation (zh <-> en).
 *
 * Triggered by `news/translate` events emitted from:
 *   - /api/news POST (auto after creation)
 *   - /api/admin/news/[id]/re-translate (admin manual)
 *   - scripts/backfill-translations.ts (historical backfill)
 *
 * Idempotent: skips when `content_translated` already populated unless
 * `force: true`.
 */
export const newsTranslate = inngest.createFunction(
  {
    id: 'news-translate',
    retries: 3,
    concurrency: { limit: 2 },
    triggers: [{ event: 'news/translate' }],
  },
  async ({ event, step }) => {
    const { newsId, force } = event.data as {
      newsId: string;
      force?: boolean;
    };

    const row = await step.run('fetch-news', async () => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from('news')
        .select('id, title, summary, content, content_translated')
        .eq('id', newsId)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`Fetch news failed: ${error.message}`);
      return data as {
        id: string;
        title: string;
        summary: string | null;
        content: string;
        content_translated: Record<string, unknown> | null;
      } | null;
    });

    if (!row) return { skipped: true, reason: 'news not found' };
    if (!force && row.content_translated) {
      return { skipped: true, reason: 'already translated' };
    }

    const translated = await step.run('translate', () =>
      translateNewsContent({
        title: row.title,
        summary: row.summary,
        content: row.content,
      })
    );

    await step.run('write-back', async () => {
      const supabase = createServiceRoleClient();
      const { error } = await supabase
        .from('news')
        .update({ content_translated: translated })
        .eq('id', newsId);
      if (error) throw new Error(`Write-back failed: ${error.message}`);
    });

    return { translated: true, newsId };
  }
);
