'use client';

import { useTranslation } from 'react-i18next';
import { getDisclaimer } from '@/lib/disclaimer';

/**
 * Soft top-notice disclaimer banner.
 *
 * Visual: white-ish background, small gray text, left border 2px orange
 * accent — restrained so it never steals focus from the report content
 * while remaining visible above the fold.
 *
 * Renders language based on the current i18n setting (EN/ZH) and switches
 * live with the global language switcher.
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
      className={`border-l-2 border-[#ff9900] bg-gray-50 px-4 py-3 text-xs text-gray-600 ${className}`}
    >
      <p className="mb-1 font-medium text-[#232f3e]">⚠ {title}</p>
      <p className="leading-relaxed">{body}</p>
    </div>
  );
}
