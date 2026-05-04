/**
 * Button — primitive for all clickable actions across the platform.
 *
 * shadcn-compatible variant API, implemented lean (no radix-ui slot dep).
 * See `.kiro/steering/ui-design-system.md` §4.2 for when to use which variant.
 *
 * Usage:
 *   <Button variant="default" size="sm">Save</Button>
 *   <Button variant="outline">Cancel</Button>
 *   <Button variant="ghost" size="icon" aria-label="Settings"><Settings /></Button>
 */

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ' +
    'disabled:pointer-events-none disabled:opacity-50 ' +
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Primary CTA — at most one per screen (ui-design-system §4.2)
        default:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/95',
        // Secondary actions — Cancel, Back, Reset
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        // Tertiary — Export, Filter, "view all"
        outline:
          'border border-border bg-card text-foreground hover:bg-muted hover:text-foreground hover:border-border-strong',
        // Row actions, icon buttons, nav items
        ghost: 'text-foreground-muted hover:bg-muted hover:text-foreground',
        // Inline-looking link button
        link: 'text-info underline-offset-4 hover:underline h-auto p-0',
        // Destructive — Delete, Remove, Revoke
        destructive:
          'bg-danger text-white shadow-sm hover:bg-danger/90 active:bg-danger/95',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
