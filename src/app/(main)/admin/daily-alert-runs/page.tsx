'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { AdminGuard } from '@/components/AdminGuard';
import { DailyAlertRunsTable } from '@/components/admin/DailyAlertRunsTable';

export default function DailyAlertRunsPage() {
  const { t } = useTranslation();
  return (
    <AdminGuard>
      <div className="max-w-[1200px] mx-auto">
        <Link
          href="/admin"
          className="mb-4 inline-block text-sm text-[#146eb4] hover:underline"
        >
          ← {t('common.back')}
        </Link>
        <h1 className="text-2xl font-bold text-[#232f3e] mb-6">
          {t('adminDailyAlert.runsTitle')}
        </h1>
        <DailyAlertRunsTable />
      </div>
    </AdminGuard>
  );
}
