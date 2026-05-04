'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { Search, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useDomain } from '@/contexts/DomainContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database';

/**
 * Reports list page.
 *
 * Design refs:
 * - ui-design-system.md §9.1 (Page header), §3.3 (Card conventions)
 * - power design-guidelines.md §5.1 Content Primacy, §5.3 Scannability, §5.4 List Design
 * - power ui-guidelines.md "App Surfaces" — Linear-style restraint, utility copy
 *
 * Row layout emphasizes scannability: title first, type badge + week_label
 * inline, date right-aligned. No decorative icons on rows (power §7.1).
 */

type ReportRow = Database['public']['Tables']['reports']['Row'];

const PAGE_SIZE = 10;

export default function ReportsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentDomainId } = useDomain();
  const supabase = useMemo(() => createClient(), []);

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState<'all' | 'regular' | 'topic'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const fetchReports = useCallback(async () => {
    if (!currentDomainId) return;
    setLoading(true);

    try {
      if (searchQuery.trim()) {
        // Use RPC search
        const { data, error } = await supabase.rpc('search_reports', {
          search_query: searchQuery.trim(),
          domain_filter: currentDomainId,
        });
        if (!error && data) {
          let filtered = data as ReportRow[];
          if (typeFilter !== 'all') {
            filtered = filtered.filter((r) => r.type === typeFilter);
          }
          setTotalCount(filtered.length);
          setReports(filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));
        }
      } else {
        let query = supabase
          .from('reports')
          .select('*', { count: 'exact' })
          .eq('domain_id', currentDomainId)
          .eq('status', 'published')
          .order('published_at', { ascending: false });

        if (typeFilter !== 'all') {
          query = query.eq('type', typeFilter);
        }

        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        query = query.range(from, to);

        const { data, error, count } = await query;
        if (!error) {
          setReports((data ?? []) as ReportRow[]);
          setTotalCount(count ?? 0);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [supabase, currentDomainId, typeFilter, searchQuery, page]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Reset page when filter/search changes
  useEffect(() => {
    setPage(0);
  }, [typeFilter, searchQuery, currentDomainId]);

  const handleSearch = () => {
    setSearchQuery(searchInput);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div>
      {/* Page header per ui-design-system §9.1 */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t('reports.title')}
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {totalCount > 0
              ? `${totalCount} ${totalCount === 1 ? 'report' : 'reports'}`
              : ''}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
            strokeWidth={1.75}
            aria-hidden
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('reports.search')}
            className="pl-9"
            aria-label={t('reports.search')}
          />
        </div>
        <div className="flex gap-2">
          <div className="w-full sm:w-48">
            <Select
              value={typeFilter}
              onChange={(e) =>
                setTypeFilter(e.target.value as 'all' | 'regular' | 'topic')
              }
              aria-label="Filter by type"
            >
              <option value="all">{t('reports.filterAll')}</option>
              <option value="regular">{t('reports.filterRegular')}</option>
              <option value="topic">{t('reports.filterTopic')}</option>
            </Select>
          </div>
          <Button variant="outline" onClick={handleSearch} size="default">
            <Search className="h-4 w-4" strokeWidth={1.75} />
            <span className="sr-only sm:not-sr-only">Search</span>
          </Button>
        </div>
      </div>

      {/* Report List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div
            role="status"
            aria-label="Loading"
            className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent"
          />
        </div>
      ) : reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card py-16 text-center">
          <FileText className="mb-3 h-10 w-10 text-foreground-subtle" strokeWidth={1.5} />
          <p className="text-sm text-foreground-muted">{t('reports.noReports')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {reports.map((report) => (
            <li key={report.id}>
              <button
                type="button"
                onClick={() => router.push(`/reports/${report.id}`)}
                className={cn(
                  'group flex w-full items-start justify-between gap-4 px-4 py-4 text-left transition-colors',
                  'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-[-2px]',
                  'sm:px-6'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      {report.title}
                    </h3>
                    <Badge variant={report.type === 'regular' ? 'info' : 'primary'}>
                      {report.type === 'regular'
                        ? t('reports.filterRegular')
                        : t('reports.filterTopic')}
                    </Badge>
                    {report.week_label && (
                      <Badge variant="outline">{report.week_label}</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-foreground-muted">
                    {report.date_range}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <span className="whitespace-nowrap text-xs text-foreground-subtle">
                    {report.published_at
                      ? new Date(report.published_at).toLocaleDateString()
                      : ''}
                  </span>
                  <ChevronRight
                    className="h-4 w-4 flex-shrink-0 text-foreground-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-foreground-muted"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          className="mt-6 flex items-center justify-center gap-2"
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          </Button>
          <span className="text-sm text-foreground-muted">
            {page + 1} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </nav>
      )}
    </div>
  );
}
