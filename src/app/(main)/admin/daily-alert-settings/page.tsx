'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { AdminGuard } from '@/components/AdminGuard';
import { DailyAlertConfigForm } from '@/components/admin/DailyAlertConfigForm';
import { TriggerDailyNowButton } from '@/components/admin/TriggerDailyNowButton';
import { DailyPromptEditor } from '@/components/admin/DailyPromptEditor';
import { SpinnerBlock } from '@/components/ui/spinner';

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
        const res = await fetch('/api/admin/daily-alert-prompts', {
          cache: 'no-store',
        });
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
      <div className="mx-auto max-w-[960px]">
        <Link
          href="/admin"
          className="mb-4 inline-flex items-center gap-1 text-sm text-info hover:underline"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          {t('common.back')}
        </Link>

        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold text-foreground">
            {t('adminDailyAlert.settingsTitle')}
          </h1>
          <TriggerDailyNowButton />
        </div>

        <section className="mb-10">
          <h2 className="mb-5 border-b border-border pb-3 text-lg font-semibold text-foreground">
            {t('adminDailyAlert.cadenceTitle')}
          </h2>
          <DailyAlertConfigForm />
        </section>

        <section>
          <h2 className="mb-5 border-b border-border pb-3 text-lg font-semibold text-foreground">
            {t('adminDailyAlert.promptsTitle')}
          </h2>

          {promptsError ? (
            <p className="text-sm text-danger-fg">{promptsError}</p>
          ) : !prompts ? (
            <SpinnerBlock label={t('common.loading')} />
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
