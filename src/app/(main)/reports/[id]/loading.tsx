import { Skeleton } from '@/components/ui/skeleton';

export default function ReportViewerLoading() {
  return (
    <div>
      {/* sticky header skeleton */}
      <div className="no-print sticky top-14 z-30 -mx-4 border-b border-border bg-card px-4 py-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="space-y-2">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="mt-4 flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-32" />
          ))}
        </div>
      </div>

      {/* body */}
      <main className="pt-6 space-y-4">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </main>
    </div>
  );
}
