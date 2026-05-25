import { createServiceRoleClient } from '@/lib/supabase/service-role';
import type { Database } from '@/types/database';

export type NewsRow = Database['public']['Tables']['news']['Row'];

export async function loadNewsList(domainId: string): Promise<NewsRow[]> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('news')
    .select('*')
    .eq('domain_id', domainId)
    .order('is_pinned', { ascending: false })
    .order('published_at', { ascending: false });
  return (data ?? []) as NewsRow[];
}
