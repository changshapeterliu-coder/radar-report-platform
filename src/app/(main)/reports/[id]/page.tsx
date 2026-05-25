import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loadReportViewer } from './loaders';
import ReportViewerClient from './ReportViewerClient';

/**
 * Report viewer — Server Component.
 *
 * Fetches the report row + its joined topic_rankings on the server in
 * parallel, then hands the typed payload to the client wrapper. The
 * Category column data is ready before the first paint — no fetch
 * waterfall after the navbar appears.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ReportViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const result = await loadReportViewer(id);

  if (result.kind === 'not_found') {
    notFound();
  }
  if (result.kind === 'error') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold text-foreground">Error</p>
          <p className="mt-2 text-sm text-foreground-muted">{result.message}</p>
        </div>
      </div>
    );
  }

  return <ReportViewerClient data={result.data} />;
}
