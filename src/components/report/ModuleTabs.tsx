'use client';

import { cn } from '@/lib/utils';

/**
 * Module tabs inside the report viewer header.
 *
 * Design refs: ui-design-system.md sec 9.3 (nav bar — use 2px primary
 * underline for active state instead of a filled pill). Matches the top
 * navbar's active indicator so users learn one pattern.
 */

export interface ModuleTabsProps {
  titles: string[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

export default function ModuleTabs({
  titles,
  activeIndex,
  onSelect,
}: ModuleTabsProps) {
  return (
    <div className="overflow-x-auto">
      <div
        role="tablist"
        aria-label="Report modules"
        className="flex min-w-max gap-1 border-b border-border"
      >
        {titles.map((title, i) => {
          const isActive = i === activeIndex;
          return (
            <button
              type="button"
              key={i}
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(i)}
              className={cn(
                'relative whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                isActive
                  ? 'text-foreground'
                  : 'text-foreground-muted hover:text-foreground'
              )}
            >
              {title}
              {isActive && (
                <span
                  aria-hidden
                  className="absolute inset-x-3 -bottom-[1px] h-0.5 bg-primary"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
