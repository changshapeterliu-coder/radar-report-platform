'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminGuard } from '@/components/AdminGuard';
import { DailyAlertConfigForm } from '@/components/admin/DailyAlertConfigForm';
import { TriggerDailyNowButton } from '@/components/admin/TriggerDailyNowButton';
import { DailyPromptEditor } from '@/components/admin/DailyPromptEditor';

/**
 * Admin daily-alert settings page. Composed of:
 *   - Cadence section: DailyAlertConfigForm + TriggerDailyNowButton
 *   - Prompts section: 2 x DailyPromptEditor (scan + canonicalization)
 *
 * The prompt editors share a single GET /api/admin/daily-alert-prompts roundtrip
 * via pre-fetched props to reduce redundant fetches.
 */
interface PromptsResponse {
  daily_scan_prompt: string | null;
  daily_canonicalization_prompt: string | null;
  defaults: {
    daily_scan_prompt: string;
    daily_canonicalization_prompt: string;
  };
}

export default function DailyAlertSettingsPage() {
  const { t } = useTranslation();
  const [prompts, setPrompts] = useState<PromptsResponse | null>(null);
  const [promptsError, setPromptsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/admin/daily-alert-prompts', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { data: PromptsResponse };
        if (!cancelled) setPrompts(body.data);
      } catch (e) {
        if (!cancelled) {
          setPromptsError(e instanceof Error ? e.message : 'Failed to load');
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AdminGuard>
      <div className="max-w-[960px] mx-auto">
        <Link
          href="/admin"
          className="mb-4 inline-block text-sm text-[#146eb4] hover:underline"
        >
          ← {t('common.back')}
        </Link>

        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-[#232f3e]">
            {t('adminDailyAlert.settingsTitle')}
          </h1>
          <TriggerDailyNowButton />
        </div>

        <section className="mb-10">
          <h2 className="text-lg font-semibold text-[#232f3e] pb-3 mb-5 border-b border-gray-200">
            {t('adminDailyAlert.cadenceTitle')}
          </h2>
          <DailyAlertConfigForm />
        </section>

        <section>
          <h2 className="text-lg font-semibold text-[#232f3e] pb-3 mb-5 border-b border-gray-200">
            {t('adminDailyAlert.promptsTitle')}
          </h2>

          {promptsError ? (
            <p className="text-sm text-red-600">{promptsError}</p>
          ) : !prompts ? (
            <p className="text-sm text-gray-500">{t('common.loading')}</p>
          ) : (
            <div className="space-y-10">
              <DailyPromptEditor
                promptType="daily_scan_prompt"
                initialCurrent={prompts.daily_scan_prompt}
                initialDefault={prompts.defaults.daily_scan_prompt}
              />
              <DailyPromptEditor
                promptType="daily_canonicalization_prompt"
                initialCurrent={prompts.daily_canonicalization_prompt}
                initialDefault={prompts.defaults.daily_canonicalization_prompt}
              />
            </div>
          )}
        </section>
      </div>
    </AdminGuard>
  );
}
