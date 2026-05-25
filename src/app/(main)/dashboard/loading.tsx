import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-level loading state for /dashboard.
 *
 * Mirrors the SSR'd structure (latest-report strip → top topics card →
 * trend card → news sidebar) so the layout doesn't reflow when the real
 * payload swaps in. Triggered by Next.js automatically during navigation
 * when the RSC payload hasn't arrived yet.
 */
export default function DashboardLoading() {
  return (
    <div>
      {/* page header */}
      <div className="mb-6">
        <Skeleton className="h-8 w-32" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* main column */}
        <div className="space-y-6 lg:col-span-2">
          {/* latest report strip */}
          <Skeleton className="h-20 w-full rounded-lg" />

          {/* top topics card */}
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-7 w-48" />
            </div>
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </div>

          {/* trend card */}
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-7 w-48" />
            </div>
            <Skeleton className="h-72 w-full" />
          </div>
        </div>

        {/* sidebar */}
        <div className="space-y-6">
          <div>
            <Skeleton className="mb-3 h-5 w-24" />
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          </div>
          <div>
            <Skeleton className="mb-3 h-5 w-24" />
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
