'use client';

/**
 * Renders a single Sample_Quote as a blockquote. Displays verbatim `text` plus
 * `source_label`. Intentionally does NOT render a URL — per Requirement 5.2
 * the topic-level `source_links[]` is the sole authoritative evidence list.
 *
 * Design refs: ui-design-system.md sec 2.2 (leading-relaxed for Chinese).
 */
export interface SampleQuoteProps {
  quote: { text: string; source_label: string };
}

export function SampleQuote({ quote }: SampleQuoteProps) {
  return (
    <blockquote className="rounded-r-md border-l-2 border-info bg-info-bg/40 py-2 pl-4 pr-3 text-sm italic text-foreground-muted">
      <p className="leading-relaxed">&ldquo;{quote.text}&rdquo;</p>
      <footer className="mt-1 text-xs not-italic text-foreground-subtle">
        — {quote.source_label}
      </footer>
    </blockquote>
  );
}
