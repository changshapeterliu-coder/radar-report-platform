import { cn } from '@/lib/utils';

/**
 * Radar — brand mark.
 *
 * Scan-pulse glyph: two concentric gray arcs (stroke) with a solid orange
 * primary dot at the center. Matches ui-design-system.md sec 1.2 — orange
 * reserved for brand signal only, neutrals carry the structural parts.
 *
 * Arcs are intentionally NOT closed circles — the gap on the upper-right
 * mimics a live radar sweep without any animation; stays calm, not gamified
 * (anti-mood from sec "Design philosophy").
 *
 * Use at:
 *   - Navbar (size 18)
 *   - Login hero (size 44)
 *   - favicon generated via src/app/icon.tsx (size 28 on 32px canvas)
 *
 * Strict token discipline: stroke colors use --foreground-muted and
 * --foreground-subtle; fill uses --primary. No raw hex.
 */
export interface LogoProps {
  /** Pixel size. Default 20. */
  size?: number;
  className?: string;
  /** Decorative: set `aria-hidden` and no title. */
  decorative?: boolean;
}

export function Logo({ size = 20, className, decorative = false }: LogoProps) {
  const titleId = decorative ? undefined : 'radar-logo-title';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-labelledby={titleId}
      className={cn('shrink-0', className)}
    >
      {!decorative && <title id={titleId}>Radar</title>}
      {/* Outer arc — a generous 270° sweep, gap at upper-right (10°→80°) */}
      <path
        d="M 12 2.25 A 9.75 9.75 0 1 0 21.75 12"
        stroke="var(--foreground-subtle)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Inner arc — tighter sweep, offset gap */}
      <path
        d="M 12 6.25 A 5.75 5.75 0 1 0 17.75 12"
        stroke="var(--foreground-muted)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Primary dot — the "signal" */}
      <circle cx="12" cy="12" r="2" fill="var(--primary)" />
    </svg>
  );
}
