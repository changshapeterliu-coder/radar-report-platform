import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import type { NewsRow } from '../loaders';
import NewsDetailClient from './NewsDetailClient';

/**
 * News detail — Server Component.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function NewsDetailPage({
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

  const service = createServiceRoleClient();
  const { data, error } = await service
    .from('news')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return (
      <div className="py-16 text-center">
        <p className="text-lg font-semibold text-foreground">Error</p>
        <p className="mt-2 text-sm text-foreground-muted">{error.message}</p>
      </div>
    );
  }
  if (!data) notFound();

  return <NewsDetailClient news={data as NewsRow} />;
}
