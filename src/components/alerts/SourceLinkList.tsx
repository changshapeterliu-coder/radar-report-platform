'use client';

import { ExternalLink } from 'lucide-react';

/**
 * Topic-level evidence links. Each opens in a new tab with `rel="noopener
 * noreferrer"`. Spec: Requirement 5.1 (source_links shape), 8.7 (detail
 * pane rendering order).
 *
 * Design refs: ui-design-system.md sec 1.3 (info token for links).
 */

export interface SourceLink {
  title: string;
  url: string;
  source_label: string;
  published_date: string | null;
}

export interface SourceLinkListProps {
  links: SourceLink[];
}

export function SourceLinkList({ links }: SourceLinkListProps) {
  if (!links || links.length === 0) {
    return <p className="text-sm text-foreground-subtle">-</p>;
  }
  return (
    <ul className="space-y-1.5">
      {links.map((link, idx) => (
        <li key={`${link.url}-${idx}`} className="text-sm">
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 break-words text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-sm"
          >
            {link.title}
            <ExternalLink
              className="h-3 w-3 flex-shrink-0 opacity-60"
              strokeWidth={1.75}
              aria-hidden
            />
          </a>
          <span className="ml-2 text-xs text-foreground-subtle">
            — {link.source_label}
            {link.published_date ? ` · ${link.published_date}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
