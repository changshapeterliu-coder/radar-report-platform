import { cn } from '@/lib/utils';

/**
 * Skeleton — neutral placeholder block used inside `loading.tsx` route
 * fallbacks while the RSC payload is en route. Pairs with prefetch on
 * the nav so the visible window between click and content is minimal,
 * and what the user sees during it is structural (not a spinner).
 *
 * Style follows ui-design-system §3.3 (rounded-lg, neutral surface).
 * No animation by default; optional `animate-pulse` for longer waits.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-muted',
        className
      )}
      aria-hidden
      {...props}
    />
  );
}
