import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { translateDailyPair } from '@/lib/daily-alert/translate';

/**
 * Per-canonical async translation (zh → en).
 *
 * Triggered by `daily-alert/translate-canonical` events. Fan-out from the
 * main run function only emits events for **newly minted** canonicals
 * (reused canonicals inherit existing _en fields via the RPC).
 *
 * Idempotent: short-circuits if canonical_title_en is already populated.
 * Admin "re-translate class" action clears the _en fields first, then
 * re-sends the event.
 *
 * Spec refs:
 *   Requirements: 10.4, 10.5
 *   Design:       §组件与接口 §2 `daily-alert-translate-canonical.ts`
 */
export const dailyAlertTranslateCanonical = inngest.createFunction(
  {
    id: 'daily-alert-translate-canonical',
    retries: 3,
    triggers: [{ event: 'daily-alert/translate-canonical' }],
  },
  async ({ event, step }) => {
    const { domainId, canonicalTopicKey } = event.data as {
      domainId: string;
      canonicalTopicKey: string;
    };

    // ── Step 1: Fetch canonical; skip if already translated ──
    const canon = await step.run('fetch-canonical', async () => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from('topic_canonicals')
        .select(
          'id, canonical_title_zh, canonical_title_en, canonical_description_zh, canonical_description_en'
        )
        .eq('domain_id', domainId)
        .eq('canonical_topic_key', canonicalTopicKey)
        .limit(1)
        .maybeSingle();
      if (error) {
        throw new Error(`Failed to fetch topic_canonical: ${error.message}`);
      }
      return data;
    });

    if (!canon) {
      return { skipped: true, reason: 'canonical not found (deleted?)' };
    }
    if (
      canon.canonical_title_en !== null &&
      typeof canon.canonical_title_en === 'string' &&
      canon.canonical_title_en.trim().length > 0
    ) {
      return { skipped: true, reason: 'already translated' };
    }

    // ── Step 2: Translate ──
    const translated = await step.run('translate', () =>
      translateDailyPair({
        kind: 'canonical',
        zh_primary: canon.canonical_title_zh,
        zh_secondary: canon.canonical_description_zh,
      })
    );

    // ── Step 3: Write back ──
    await step.run('write-back', async () => {
      const supabase = createServiceRoleClient();
      const { error } = await supabase
        .from('topic_canonicals')
        .update({
          canonical_title_en: translated.en_primary,
          canonical_description_en: translated.en_secondary,
          updated_at: new Date().toISOString(),
        })
        .eq('domain_id', domainId)
        .eq('canonical_topic_key', canonicalTopicKey);
      if (error) {
        throw new Error(`Failed to update topic_canonicals with translation: ${error.message}`);
      }
    });

    return { translated: true, canonicalTopicKey };
  }
);
