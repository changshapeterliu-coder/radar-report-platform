'use client';

/**
 * Renders a single Sample_Quote as a blockquote. Displays verbatim `text` plus
 * `source_label`. Intentionally does NOT render a URL — per Requirement 5.2 the
 * topic-level `source_links[]` is the sole authoritative evidence list.
 */
export interface SampleQuoteProps {
  quote: { text: string; source_label: string };
}

export function SampleQuote({ quote }: SampleQuoteProps) {
  return (
    <blockquote className="border-l-4 border-blue-200 bg-blue-50/30 pl-4 pr-3 py-2 italic text-gray-700 text-sm rounded-r">
      <p className="leading-relaxed">&ldquo;{quote.text}&rdquo;</p>
      <footer className="mt-1 text-xs not-italic text-gray-500">— {quote.source_label}</footer>
    </blockquote>
  );
}
