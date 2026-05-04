/**
 * Shared UI utilities — the shadcn/ui foundation.
 *
 * `cn()` merges Tailwind class names safely: later classes win over earlier
 * ones for the same utility, conditionally-applied classes are resolved,
 * and duplicates are collapsed. This is THE helper every shadcn/ui component
 * uses to compose its `className` prop.
 *
 * Usage:
 *   cn('px-4 py-2', isActive && 'bg-primary', className)
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
