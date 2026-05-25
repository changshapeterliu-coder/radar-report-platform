'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { Search, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getDisplayReportTitle } from '@/lib/content-display';
import type { ReportsListData, ReportTypeFilter } from './loaders';

/**
 * Client wrapper around the SSR'd reports list. The data was already
 * fetched on the server; this component only handles user input and
 * navigates by writing to the URL — the RSC re-runs and re-serves with
 * the new query.
 *
 * URL search params drive everything (?type=regular&q=foo&page=2). Side
 * effects: back button works, links are shareable, no client-side fetch
 * waterfall.
 */
export default function ReportsListClient({ data }: { data: ReportsListData }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();

  const { reports, totalCount, page, totalPages, typeFilter, searchQuery } =
    data;

  const [searchInput, setSearchInput] = useState(searchQuery);

  const updateParams = (
    patch: Partial<{ type: ReportTypeFilter; q: string; page: number }>
  ) => {
    const params = new URLSearchParams(searchParams.toString());
    if (patch.type !== undefined) {
      if (patch.type === 'all') params.delete('type');
      else params.set('type', patch.type);
      params.delete('page');
    }
    if (patch.q !== undefined) {
      if (patch.q.trim() === '') params.delete('q');
      else params.set('q', patch.q.trim());
      params.delete('page');
    }
    if (patch.page !== undefined) {
      if (patch.page === 0) params.delete('page');
      else params.set('page', String(patch.page));
    }
    router.push(`/reports${params.toString() ? '?' + params.toString() : ''}`);
  };

  const handleSearch = () => updateParams({ q: searchInput });
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div>
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
                updateParams({ type: e.target.value as ReportTypeFilter })
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

      {/* Report list */}
      {reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card py-16 text-center">
          <FileText
            className="mb-3 h-10 w-10 text-foreground-subtle"
            strokeWidth={1.5}
          />
          <p className="text-sm text-foreground-muted">
            {t('reports.noReports')}
          </p>
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
                      {getDisplayReportTitle(report, i18n.language)}
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

      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          className="mt-6 flex items-center justify-center gap-2"
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => updateParams({ page: Math.max(0, page - 1) })}
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
            onClick={() =>
              updateParams({ page: Math.min(totalPages - 1, page + 1) })
            }
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
