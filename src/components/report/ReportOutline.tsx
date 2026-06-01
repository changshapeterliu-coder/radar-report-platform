'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { Section } from '@/lib/report-export';

/**
 * ReportOutline — the Quip-style reading-layout navigation for the report
 * viewer. Renders a sticky sidebar outline on desktop and a native dropdown
 * on mobile, and owns the scroll-spy + scroll-jump behavior.
 *
 * Self-contained: it derives nothing about the report. It receives the
 * already-derived `sections` (the single source of truth shared with the
 * body's `<section id>` anchors) and reads section DOM nodes by their
 * `module-${i}` id. Outline labels, scroll-spy targets, and body anchors
 * therefore cannot drift.
 *
 * Visual language:
 *  - Active entry carries the ModuleTabs 2px-primary idea, rendered here as a
 *    left border (`border-l-2 border-primary`) + `bg-primary-soft` tint.
 *  - All colors come from design-system tokens (ui-design-system.md) — no raw
 *    hex. The prototype `prototype/report-view-quip-layout.html` is the
 *    interaction target.
 *
 * Scroll-spy uses an IntersectionObserver with `rootMargin: '-76px 0px -65%
 * 0px'` (copied from the prototype): the top inset discounts the 56px sticky
 * site nav plus breathing room; the bottom inset shrinks the active zone to
 * roughly the top third of the viewport so the highlighted entry is the
 * section the reader is actually reading.
 */

export interface ReportOutlineProps {
  sections: Section[];
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

export default function ReportOutline({ sections }: ReportOutlineProps) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string>(
    sections.length > 0 ? sections[0].id : ''
  );

  // Stable key: re-run the observer effect only when the section id set
  // actually changes, not on every render that produces a new array identity.
  const sectionKey = sections.map((s) => s.id).join(',');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;

    // Resolve each section's DOM node; null-guard sections that failed to
    // render (a per-section ErrorBoundary may have blanked one).
    const targets = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);

    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: '-76px 0px -65% 0px', threshold: 0 }
    );

    targets.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
    // sectionKey captures the meaningful identity of `sections`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionKey]);

  if (sections.length === 0) return null;

  return (
    <>
      {/* Desktop sticky sidebar outline */}
      <aside className="no-print hidden self-start lg:sticky lg:top-[76px] lg:block lg:max-h-[calc(100vh-96px)] lg:overflow-y-auto">
        <div className="px-3 pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
          {t('report.outline.label')}
        </div>
        <ul className="space-y-0.5">
          {sections.map((section, i) => {
            const isActive = section.id === activeId;
            return (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToSection(section.id);
                  }}
                  className={cn(
                    'flex gap-2.5 rounded-lg border-l-2 px-3 py-2 text-[13px] leading-snug transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    isActive
                      ? 'border-primary bg-primary-soft font-medium text-foreground'
                      : 'border-transparent text-foreground-muted hover:bg-muted hover:text-foreground'
                  )}
                >
                  <span
                    className={cn(
                      'flex-shrink-0 tabular-nums',
                      isActive ? 'text-primary' : 'text-foreground-subtle'
                    )}
                  >
                    {i + 1}
                  </span>
                  <span>{section.title}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Mobile collapsed outline — native select self-collapses after choose */}
      <div className="no-print sticky top-14 z-30 -mx-4 border-b border-border bg-card px-4 py-2.5 sm:-mx-6 sm:px-6 lg:hidden">
        <select
          aria-label={t('report.outline.label')}
          value={activeId}
          onChange={(e) => {
            setActiveId(e.target.value);
            scrollToSection(e.target.value);
          }}
          className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {sections.map((section, i) => (
            <option key={section.id} value={section.id}>
              {`${i + 1}. ${section.title}`}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
