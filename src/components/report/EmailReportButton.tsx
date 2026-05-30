'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRole } from '@/hooks/useRole';
import { EmailInstructionDialog } from '@/components/report/EmailInstructionDialog';

export interface EmailReportButtonProps {
  reportId: string;
  title: string;
  status: string;
}

/**
 * Admin-only trigger to hand a published report to the `send-report-email`
 * Kiro skill. Renders nothing unless the viewer is an admin AND the report is
 * published (Req 1.1–1.4) — it reuses the existing role hook and the report
 * row's existing status field, introducing no new authorization.
 *
 * Clicking opens EmailInstructionDialog, which shows a copy-to-clipboard
 * instruction snippet. The platform never sends an email itself.
 */
export function EmailReportButton({
  reportId,
  title,
  status,
}: EmailReportButtonProps) {
  const { t } = useTranslation();
  const { isAdmin } = useRole();
  const [open, setOpen] = useState(false);

  if (!isAdmin || status !== 'published') return null;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Mail className="h-4 w-4" strokeWidth={1.75} />
        {t('reports.emailReport.button')}
      </Button>
      {open && (
        <EmailInstructionDialog
          reportId={reportId}
          title={title}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
