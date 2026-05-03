import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { translateDailyPair } from '@/lib/daily-alert/translate';

/**
 * Per-topic async translation (zh → en).
 *
 * Triggered by `daily-alert/translate-topic` events fanned out from the
 * main run function's `enqueue-translations` step after successful persist.
 *
 * Idempotent: short-circuits if topic_name_en is already populated.
 * Admin "re-translate topic" action clears the _en fields first, then
 * re-sends the event.
 *
 * Spec refs:
 *   Requirements: 10.3, 10.4, 10.5
 *   Design:       §组件与接口 §2 `daily-alert-translate-topic.ts`
 */
export const dailyAlertTranslateTopic = inngest.createFunction(
  {
    id: 'daily-alert-translate-topic',
    retries: 3,
    triggers: [{ event: 'daily-alert/translate-topic' }],
  },
  async ({ event, step }) => {
    const { topicId } = event.data as { topicId: string; domainId: string };

    // ── Step 1: Fetch topic; skip if already translated or missing ──
    const topic = await step.run('fetch-topic', async () => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from('daily_hot_topics')
        .select('id, topic_name_zh, topic_name_en, summary_zh, summary_en')
        .eq('id', topicId)
        .limit(1)
        .maybeSingle();
      if (error) {
        throw new Error(`Failed to fetch daily_hot_topic: ${error.message}`);
      }
      return data;
    });

    if (!topic) {
      return { skipped: true, reason: 'topic not found (deleted?)' };
    }
    if (
      topic.topic_name_en !== null &&
      typeof topic.topic_name_en === 'string' &&
      topic.topic_name_en.trim().length > 0
    ) {
      return { skipped: true, reason: 'already translated' };
    }

    // ── Step 2: Translate via OpenRouter ──
    const translated = await step.run('translate', () =>
      translateDailyPair({
        kind: 'topic',
        zh_primary: topic.topic_name_zh,
        zh_secondary: topic.summary_zh,
      })
    );

    // ── Step 3: Write back ──
    await step.run('write-back', async () => {
      const supabase = createServiceRoleClient();
      const { error } = await supabase
        .from('daily_hot_topics')
        .update({
          topic_name_en: translated.en_primary,
          summary_en: translated.en_secondary,
        })
        .eq('id', topicId);
      if (error) {
        throw new Error(`Failed to update daily_hot_topics with translation: ${error.message}`);
      }
    });

    return { translated: true, topicId };
  }
);
