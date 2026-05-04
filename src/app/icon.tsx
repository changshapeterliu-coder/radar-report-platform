import { ImageResponse } from 'next/og';

/**
 * Next.js App Router file-based metadata: generates the browser-tab favicon
 * (icon.png) at build time.
 *
 * Design: same scan-pulse glyph as <Logo /> (src/components/Logo.tsx) but
 * rendered on a 32×32 canvas so it stays crisp as a favicon.
 *
 * Hex values are intentional — ImageResponse runs outside the CSS/Tailwind
 * token system, so we hard-code the color values equivalent to
 *   --foreground-subtle = #9ca3af
 *   --foreground-muted  = #6b7280
 *   --primary           = #ff9900
 * If globals.css tokens change, mirror them here.
 */

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M 12 2.25 A 9.75 9.75 0 1 0 21.75 12"
            stroke="#9ca3af"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <path
            d="M 12 6.25 A 5.75 5.75 0 1 0 17.75 12"
            stroke="#6b7280"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <circle cx="12" cy="12" r="2.25" fill="#ff9900" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
