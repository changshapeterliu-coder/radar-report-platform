'use client';

import Link from 'next/link';
import { AdminGuard } from '@/components/AdminGuard';
import { useDomain } from '@/contexts/DomainContext';
import { ScheduleConfigForm } from '@/components/admin/ScheduleConfigForm';
import { PromptTemplateEditor } from '@/components/admin/PromptTemplateEditor';
import { TriggerNowButton } from '@/components/admin/TriggerNowButton';

export default function ScheduleSettingsPage() {
  const { currentDomainId } = useDomain();

  return (
    <AdminGuard>
      <div className="max-w-[880px] mx-auto px-4 py-10">
        <Link href="/admin" className="mb-4 inline-block text-sm text-[#146eb4] hover:underline">
          ← Back to Admin
        </Link>

        <div className="flex items-center justify-between gap-4 mb-8">
          <h1 className="text-2xl font-bold text-[#232f3e]">Schedule Settings</h1>
          {currentDomainId && <TriggerNowButton domainId={currentDomainId} />}
        </div>

        {!currentDomainId ? (
          <p className="text-sm text-gray-500">Loading domain...</p>
        ) : (
          <>
            <section className="mb-10">
              <h2 className="text-lg font-semibold text-[#232f3e] pb-3 mb-5 border-b border-gray-200">
                Cadence
              </h2>
              <ScheduleConfigForm domainId={currentDomainId} />
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#232f3e] pb-3 mb-5 border-b border-gray-200">
                Prompt Templates
              </h2>
              <div className="space-y-10">
                <PromptTemplateEditor domainId={currentDomainId} promptType="engine_a_hot_radar" />
                <PromptTemplateEditor domainId={currentDomainId} promptType="engine_b_hot_radar" />
                <PromptTemplateEditor domainId={currentDomainId} promptType="shared_deep_dive" />
                <PromptTemplateEditor domainId={currentDomainId} promptType="synthesizer_prompt" />
              </div>
            </section>
          </>
        )}
      </div>
    </AdminGuard>
  );
}
