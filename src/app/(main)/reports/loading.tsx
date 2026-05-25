import { Skeleton } from '@/components/ui/skeleton';

export default function ReportsLoading() {
  return (
    <div>
      {/* page header */}
      <div className="mb-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-1 h-4 w-24" />
      </div>

      {/* filters */}
      <div className="mb-6 flex gap-3">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-24" />
      </div>

      {/* list */}
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-4 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
