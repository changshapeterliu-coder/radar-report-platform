'use client';

export interface SourceLink {
  title: string;
  url: string;
  source_label: string;
  published_date: string | null;
}

export interface SourceLinkListProps {
  links: SourceLink[];
}

/**
 * Renders the topic-level evidence list as external links.
 * Each link opens in a new tab with `rel="noopener noreferrer"` for safety.
 *
 * Spec: Requirement 5.1 (source_links shape), 8.7 (detail pane rendering order).
 */
export function SourceLinkList({ links }: SourceLinkListProps) {
  if (!links || links.length === 0) {
    return <p className="text-sm text-gray-400">—</p>;
  }
  return (
    <ul className="space-y-1.5">
      {links.map((link, idx) => (
        <li key={`${link.url}-${idx}`} className="text-sm">
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#146eb4] hover:underline break-words"
          >
            {link.title}
          </a>
          <span className="text-xs text-gray-500 ml-2">
            — {link.source_label}
            {link.published_date ? ` · ${link.published_date}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
