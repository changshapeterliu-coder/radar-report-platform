'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AdminGuard } from '@/components/AdminGuard';
import { useDomain } from '@/contexts/DomainContext';
import { ScheduleConfigForm } from '@/components/admin/ScheduleConfigForm';
import { PromptTemplateEditor } from '@/components/admin/PromptTemplateEditor';
import { TriggerNowButton } from '@/components/admin/TriggerNowButton';

export default function ScheduleSettingsPage() {
  const { currentDomainId } = useDomain();

  return (
    <AdminGuard>
      <div className="mx-auto max-w-[880px]">
        <Link
          href="/admin"
          className="mb-4 inline-flex items-center gap-1 text-sm text-info hover:underline"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          Back to Admin
        </Link>

        <div className="mb-8 flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold text-foreground">
            Schedule Settings
          </h1>
          {currentDomainId && <TriggerNowButton domainId={currentDomainId} />}
        </div>

        {!currentDomainId ? (
          <p className="text-sm text-foreground-muted">Loading domain...</p>
        ) : (
          <>
            <section className="mb-10">
              <h2 className="mb-5 border-b border-border pb-3 text-lg font-semibold text-foreground">
                Cadence
              </h2>
              <ScheduleConfigForm domainId={currentDomainId} />
            </section>

            <section>
              <h2 className="mb-5 border-b border-border pb-3 text-lg font-semibold text-foreground">
                Prompt Templates
              </h2>
              <div className="space-y-10">
                <PromptTemplateEditor
                  domainId={currentDomainId}
                  promptType="engine_a_hot_radar"
                />
                <PromptTemplateEditor
                  domainId={currentDomainId}
                  promptType="engine_b_hot_radar"
                />
                <PromptTemplateEditor
                  domainId={currentDomainId}
                  promptType="shared_deep_dive"
                />
                <PromptTemplateEditor
                  domainId={currentDomainId}
                  promptType="synthesizer_prompt"
                />
              </div>
            </section>
          </>
        )}
      </div>
    </AdminGuard>
  );
}
