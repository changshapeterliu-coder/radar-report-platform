'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { AdminGuard } from '@/components/AdminGuard';
import { DailyAlertRunsTable } from '@/components/admin/DailyAlertRunsTable';

export default function DailyAlertRunsPage() {
  const { t } = useTranslation();
  return (
    <AdminGuard>
      <div className="mx-auto max-w-[1200px]">
        <Link
          href="/admin"
          className="mb-4 inline-flex items-center gap-1 text-sm text-info hover:underline"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          {t('common.back')}
        </Link>
        <h1 className="mb-8 text-2xl font-semibold text-foreground">
          {t('adminDailyAlert.runsTitle')}
        </h1>
        <DailyAlertRunsTable />
      </div>
    </AdminGuard>
  );
}
