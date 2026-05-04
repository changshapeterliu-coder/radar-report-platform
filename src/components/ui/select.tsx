/**
 * Select — native <select> wrapper styled to match Input.
 *
 * For simple "pick one of N options" menus (e.g. report type filter).
 * This is a lean native implementation — not the radix-ui-based shadcn Select
 * with popover/virtualization. When we need multi-value or searchable, we'll
 * introduce a richer component; for now the native element is accessible,
 * free, and renders perfectly on mobile.
 */

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => {
  return (
    <div className="relative inline-block w-full">
      <select
        ref={ref}
        className={cn(
          'flex h-10 w-full appearance-none rounded-md border border-input bg-card px-3 pr-9 py-2 text-sm text-foreground',
          'transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:border-border-strong',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
        strokeWidth={1.75}
        aria-hidden
      />
    </div>
  );
});
Select.displayName = 'Select';

export { Select };
