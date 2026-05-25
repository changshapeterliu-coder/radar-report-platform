import { Skeleton } from '@/components/ui/skeleton';

export default function NewsDetailLoading() {
  return (
    <div className="mx-auto max-w-3xl">
      <Skeleton className="mb-4 h-8 w-20" />

      <article className="rounded-lg border border-border bg-card p-6 sm:p-8">
        <div className="mb-3 flex gap-2">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-6 w-20" />
        </div>
        <Skeleton className="h-9 w-3/4" />
        <Skeleton className="mt-2 h-4 w-32" />

        <div className="mt-6 space-y-3">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      </article>
    </div>
  );
}
