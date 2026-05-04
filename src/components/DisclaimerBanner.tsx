'use client';

import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { getDisclaimer } from '@/lib/disclaimer';
import { cn } from '@/lib/utils';

/**
 * Soft top-notice disclaimer banner.
 *
 * Visual: muted bg, small gray text, left border 2px primary accent +
 * Info icon — restrained so it never steals focus from the report content
 * while remaining visible above the fold.
 *
 * Design refs: ui-design-system.md sec 1 (tokens), sec 4.4 (no emoji).
 */
export default function DisclaimerBanner({
  className = '',
}: {
  /** Optional extra class names for spacing in specific contexts. */
  className?: string;
}) {
  const { i18n } = useTranslation();
  const { title, body } = getDisclaimer(i18n.language);

  return (
    <div
      role="note"
      aria-label={title}
      className={cn(
        'flex gap-2.5 rounded-md border-l-2 border-primary bg-muted/60 px-4 py-3 text-xs text-foreground-muted',
        className
      )}
    >
      <Info
        className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary"
        strokeWidth={2}
        aria-hidden
      />
      <div>
        <p className="mb-1 font-medium text-foreground">{title}</p>
        <p className="leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
