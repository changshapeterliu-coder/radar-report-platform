import { ImageResponse } from 'next/og';

/**
 * Apple touch icon (180×180). Same scan-pulse glyph as <Logo />, rendered
 * on a larger canvas with a subtle rounded-square background for the iOS
 * home-screen context (otherwise the glyph sits on an ugly white square).
 *
 * Hex values mirror tokens — see src/app/icon.tsx header for rationale.
 */

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#ffffff',
          borderRadius: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="120"
          height="120"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M 12 2.25 A 9.75 9.75 0 1 0 21.75 12"
            stroke="#9ca3af"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M 12 6.25 A 5.75 5.75 0 1 0 17.75 12"
            stroke="#6b7280"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="12" cy="12" r="2" fill="#ff9900" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
