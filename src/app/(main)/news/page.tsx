import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentDomainIdServer } from '@/lib/domain/server';
import { loadNewsList } from './loaders';
import NewsListClient from './NewsListClient';

/**
 * News list — Server Component.
 *
 * SSR'd; the navbar and the news rows arrive in the same paint.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function NewsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const domainId = await getCurrentDomainIdServer();
  const news = domainId ? await loadNewsList(domainId) : [];

  return <NewsListClient news={news} />;
}
