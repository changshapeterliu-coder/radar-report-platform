'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import {
  Clock,
  Play,
  Bell,
  BarChart3,
  FileText,
  Newspaper,
  Users,
  Globe,
  Pencil,
  Trash2,
  Pin,
  ClipboardList,
} from 'lucide-react';
import { AdminGuard } from '@/components/AdminGuard';
import { createClient } from '@/lib/supabase/client';
import { useDomain } from '@/contexts/DomainContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SpinnerBlock } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database';

/**
 * Admin hub page.
 *
 * Design refs:
 * - ui-design-system.md sec 3.3, sec 4.4 (no emoji in UI chrome),
 *   sec 4.2 (button hierarchy — only one primary per screen)
 * - power design-guidelines.md sec 5.2 Information Hierarchy,
 *   sec 5.6 Navigation Systems, sec 3.3 Consistency
 */

type ReportRow = Database['public']['Tables']['reports']['Row'];
type NewsRow = Database['public']['Tables']['news']['Row'];

interface ReportRequest {
  id: string;
  user_id: string;
  topic: string;
  description: string | null;
  marketplace: string;
  seller_origin: string;
  status: string;
  created_at: string;
}

export default function AdminPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentDomainId } = useDomain();
  const supabase = useMemo(() => createClient(), []);
  const [drafts, setDrafts] = useState<ReportRow[]>([]);
  const [published, setPublished] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishedLoading, setPublishedLoading] = useState(true);

  const [newsItems, setNewsItems] = useState<NewsRow[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [actioningNewsId, setActioningNewsId] = useState<string | null>(null);

  const [requests, setRequests] = useState<ReportRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);

  const fetchDrafts = useCallback(async () => {
    if (!currentDomainId) return;
    setLoading(true);
    const { data } = await supabase
      .from('reports')
      .select('*')
      .eq('domain_id', currentDomainId)
      .eq('status', 'draft')
      .order('updated_at', { ascending: false });
    setDrafts((data ?? []) as ReportRow[]);
    setLoading(false);
  }, [supabase, currentDomainId]);

  const fetchPublished = useCallback(async () => {
    if (!currentDomainId) return;
    setPublishedLoading(true);
    const { data } = await supabase
      .from('reports')
      .select('*')
      .eq('domain_id', currentDomainId)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(20);
    setPublished((data ?? []) as ReportRow[]);
    setPublishedLoading(false);
  }, [supabase, currentDomainId]);

  const fetchNews = useCallback(async () => {
    if (!currentDomainId) return;
    setNewsLoading(true);
    const { data } = await supabase
      .from('news')
      .select('*')
      .eq('domain_id', currentDomainId)
      .order('is_pinned', { ascending: false })
      .order('published_at', { ascending: false });
    setNewsItems((data ?? []) as NewsRow[]);
    setNewsLoading(false);
  }, [supabase, currentDomainId]);

  const fetchRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const res = await fetch('/api/requests');
      if (res.ok) {
        const { data } = await res.json();
        setRequests(data ?? []);
      }
    } catch {
      /* ignore */
    }
    setRequestsLoading(false);
  }, []);

  useEffect(() => {
    fetchDrafts();
    fetchPublished();
    fetchNews();
    fetchRequests();
  }, [fetchDrafts, fetchPublished, fetchNews, fetchRequests]);

  const handlePublish = async (id: string) => {
    const res = await fetch(`/api/reports/${id}/publish`, { method: 'PUT' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // Surface the server gate (e.g. WEEK_LABEL_REQUIRED) instead of silently
      // doing nothing — the draft stays a draft and the operator sees why.
      window.alert(data.message || 'Publish failed.');
      return;
    }
    fetchDrafts();
    fetchPublished();
  };

  const handleDelete = async (id: string) => {
    await supabase.from('reports').delete().eq('id', id);
    fetchDrafts();
    fetchPublished();
  };

  const handleDeleteNews = async (id: string) => {
    setActioningNewsId(id);
    await fetch(`/api/news/${id}`, { method: 'DELETE' });
    fetchNews();
    setActioningNewsId(null);
  };

  const handleTogglePin = async (id: string, currentlyPinned: boolean) => {
    setActioningNewsId(id);
    await fetch(`/api/news/${id}/pin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_pinned: !currentlyPinned }),
    });
    fetchNews();
    setActioningNewsId(null);
  };

  const requestStatusVariant = (
    status: string
  ): 'warning' | 'info' | 'success' | 'danger' | 'outline' => {
    if (status === 'pending') return 'warning';
    if (status === 'in_progress') return 'info';
    if (status === 'completed') return 'success';
    if (status === 'rejected') return 'danger';
    return 'outline';
  };

  return (
    <AdminGuard>
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">
            {t('admin.title')}
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Content management, scheduling, and user access.
          </p>
        </div>

        {/* Automation — 4 up */}
        <SectionHeading title="Automation" />
        <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NavTile
            href="/admin/schedule-settings"
            icon={Clock}
            label="Schedule Settings"
          />
          <NavTile
            href="/admin/scheduled-runs"
            icon={Play}
            label="Scheduled Runs"
          />
          <NavTile
            href="/admin/daily-alert-settings"
            icon={Bell}
            label="Daily Alert Settings"
          />
          <NavTile
            href="/admin/daily-alert-runs"
            icon={BarChart3}
            label="Daily Alert Runs"
          />
        </div>

        {/* Content + Users — 4 up */}
        <SectionHeading title="Content & Access" />
        <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NavTile
            href="/admin/reports/new"
            icon={FileText}
            label={t('admin.createReport')}
          />
          <NavTile
            href="/admin/news/new"
            icon={Newspaper}
            label={t('admin.createNews')}
          />
          <NavTile href="/admin/users" icon={Users} label="Manage Users" />
          <NavTile
            href="#"
            icon={Globe}
            label={t('admin.manageDomains')}
            disabled
          />
        </div>

        {/* Draft Reports */}
        <SectionHeading title={t('admin.drafts')} />
        {loading ? (
          <SpinnerBlock />
        ) : drafts.length === 0 ? (
          <EmptyLine label={t('common.noData')} />
        ) : (
          <ul className="mb-8 divide-y divide-border rounded-lg border border-border bg-card">
            {drafts.map((draft) => (
              <li
                key={draft.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-foreground">
                    {draft.title}
                  </h3>
                  <p className="mt-1 text-xs text-foreground-muted">
                    {draft.type === 'regular'
                      ? t('reports.filterRegular')
                      : t('reports.filterTopic')}{' '}
                    · {draft.date_range}
                  </p>
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      router.push(`/admin/reports/${draft.id}/edit`)
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {t('common.edit', 'Edit')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handlePublish(draft.id)}
                  >
                    {t('admin.publish')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(draft.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    <span className="sr-only sm:not-sr-only">
                      {t('admin.delete')}
                    </span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Published Reports */}
        <SectionHeading title="Published Reports" />
        {publishedLoading ? (
          <SpinnerBlock />
        ) : published.length === 0 ? (
          <EmptyLine label={t('common.noData')} />
        ) : (
          <ul className="mb-8 divide-y divide-border rounded-lg border border-border bg-card">
            {published.map((report) => (
              <li
                key={report.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-foreground">
                    {report.title}
                  </h3>
                  <p className="mt-1 text-xs text-foreground-muted">
                    {report.type === 'regular'
                      ? t('reports.filterRegular')
                      : t('reports.filterTopic')}{' '}
                    · {report.date_range}
                    {report.published_at &&
                      ` · Published ${new Date(report.published_at).toLocaleDateString()}`}
                  </p>
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      router.push(`/admin/reports/${report.id}/edit`)
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {t('common.edit', 'Edit')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(report.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    <span className="sr-only sm:not-sr-only">
                      {t('admin.delete')}
                    </span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Report Requests */}
        <SectionHeading title="Report Requests" />
        {requestsLoading ? (
          <SpinnerBlock />
        ) : requests.length === 0 ? (
          <EmptyLine label="No report requests yet." />
        ) : (
          <ul className="mb-8 divide-y divide-border rounded-lg border border-border bg-card">
            {requests.map((req) => (
              <li key={req.id} className="px-4 py-4 sm:px-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">
                        {req.topic}
                      </h3>
                      <Badge variant={requestStatusVariant(req.status)}>
                        {req.status}
                      </Badge>
                    </div>
                    {req.description && (
                      <p className="mt-1.5 text-sm leading-relaxed text-foreground-muted">
                        {req.description}
                      </p>
                    )}
                    <p className="mt-1.5 text-xs text-foreground-subtle">
                      {req.marketplace} · {req.seller_origin} ·{' '}
                      {new Date(req.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  {req.status === 'pending' && (
                    <div className="flex flex-shrink-0 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          await supabase
                            .from('report_requests')
                            .update({ status: 'in_progress' })
                            .eq('id', req.id);
                          fetchRequests();
                        }}
                      >
                        Start
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          await supabase
                            .from('report_requests')
                            .update({ status: 'completed' })
                            .eq('id', req.id);
                          fetchRequests();
                        }}
                      >
                        Done
                      </Button>
                    </div>
                  )}
                  {req.status === 'in_progress' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        await supabase
                          .from('report_requests')
                          .update({ status: 'completed' })
                          .eq('id', req.id);
                        fetchRequests();
                      }}
                    >
                      Done
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* News Management */}
        <SectionHeading title="News Management" />
        {newsLoading ? (
          <SpinnerBlock />
        ) : newsItems.length === 0 ? (
          <EmptyLine label="No news items found." />
        ) : (
          <ul className="mb-8 divide-y divide-border rounded-lg border border-border bg-card">
            {newsItems.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      {item.title}
                    </h3>
                    {item.is_pinned && (
                      <Badge variant="danger">
                        <Pin className="h-2.5 w-2.5" strokeWidth={2} />
                        Pinned
                      </Badge>
                    )}
                    <Badge variant="outline">{item.source_channel}</Badge>
                  </div>
                  <p className="mt-1.5 text-xs text-foreground-subtle">
                    {new Date(item.published_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      router.push(`/admin/news/${item.id}/edit`)
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleTogglePin(item.id, item.is_pinned)
                    }
                    disabled={actioningNewsId === item.id}
                  >
                    <Pin className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {item.is_pinned ? 'Unpin' : 'Pin'}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDeleteNews(item.id)}
                    disabled={actioningNewsId === item.id}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    <span className="sr-only sm:not-sr-only">Delete</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminGuard>
  );
}

// ── Sub-components ──

function SectionHeading({ title }: { title: string }) {
  return (
    <h2 className="mb-3 text-lg font-semibold text-foreground">{title}</h2>
  );
}

function EmptyLine({ label }: { label: string }) {
  return (
    <div className="mb-8 flex items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-6 text-sm text-foreground-muted">
      <ClipboardList
        className="h-4 w-4 text-foreground-subtle"
        strokeWidth={1.75}
        aria-hidden
      />
      {label}
    </div>
  );
}

function NavTile({
  href,
  icon: Icon,
  label,
  disabled = false,
}: {
  href: string;
  icon: typeof Clock;
  label: string;
  disabled?: boolean;
}) {
  const inner = (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors',
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'hover:border-border-strong hover:bg-muted/40'
      )}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground-muted">
        <Icon className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden />
      </div>
      <span className="text-sm font-medium text-foreground">{label}</span>
    </div>
  );
  if (disabled) return inner;
  return (
    <Link
      href={href}
      className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      {inner}
    </Link>
  );
}
