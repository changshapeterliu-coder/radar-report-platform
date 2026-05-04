/**
 * Badge — compact status/category tag.
 *
 * Variants aligned to the semantic tokens in `ui-design-system.md` §1.3:
 *   default   → neutral gray (uncategorized type indicators)
 *   outline   → border-only, transparent bg (counts, minor labels)
 *   info      → blue (informational)
 *   success   → green (succeeded runs)
 *   warning   → amber (medium severity, needs-check)
 *   danger    → red (high severity, failed runs)
 *   primary   → orange (Hot flag — sparingly)
 *
 * Rule from power `design-guidelines.md` §6.2: emphasis sparingly — prefer
 * `default` or `outline` 90% of the time; save `danger`/`primary` for real
 * semantic signal.
 */

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted text-foreground-muted',
        outline: 'border-border text-foreground-muted',
        info: 'border-info/20 bg-info-bg text-info-fg',
        success: 'border-success/20 bg-success-bg text-success-fg',
        warning: 'border-warning/20 bg-warning-bg text-warning-fg',
        danger: 'border-danger/20 bg-danger-bg text-danger-fg',
        primary: 'border-primary/30 bg-primary-soft text-primary',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
