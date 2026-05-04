/**
 * Spinner — loading indicator aligned with design tokens.
 *
 * Used for the <500ms interactive loading states (lists, detail pages).
 * For longer operations prefer a skeleton placeholder; for sub-200ms skip
 * the spinner entirely to avoid flashing.
 */

import { cn } from '@/lib/utils';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4 border-2',
  md: 'h-8 w-8 border-4',
  lg: 'h-12 w-12 border-4',
};

export function Spinner({ size = 'md', className, label = 'Loading' }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn(
        'inline-block animate-spin rounded-full border-primary border-r-transparent',
        sizeClasses[size],
        className
      )}
    />
  );
}

export function SpinnerBlock({ label }: { label?: string }) {
  return (
    <div className="flex justify-center py-12">
      <Spinner label={label} />
    </div>
  );
}
