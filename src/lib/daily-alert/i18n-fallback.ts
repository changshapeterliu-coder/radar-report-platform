/**
 * Bilingual fallback helper for the /alerts UI.
 *
 * Pattern:
 *   - User's i18n language is 'zh' → always render the Chinese field.
 *   - User's i18n language is 'en':
 *       - If the English field is populated (non-empty string) → render it.
 *       - Else → fall back to the Chinese source + a visible
 *         "(Chinese original)" indicator so the user sees the content
 *         rather than a blank.
 *
 * Pure function — no React import. The UI layer wraps this result.
 *
 * Spec refs:
 *   Requirement 8.11 (bilingual fallback with indicator on /alerts)
 *   Requirement 10.5 (translation failure leaves row published in Chinese)
 * Property refs (PBT):
 *   P34 — Bilingual fallback rendering for topic
 *   P35 — Bilingual fallback rendering for canonical
 */

export interface ResolvedText {
  /** The string to display. */
  text: string;
  /** Whether the UI should render a "(Chinese original)" indicator next to it. */
  needsFallbackIndicator: boolean;
}

/**
 * Resolve bilingual text for a single field pair.
 *
 * @param zh      The Chinese source-of-truth (non-null in practice; typed loosely for safety)
 * @param en      The English translated value, may be null / empty / not-yet-translated
 * @param lang    The user's current i18n language
 */
export function resolveText(
  zh: string | null | undefined,
  en: string | null | undefined,
  lang: 'zh' | 'en'
): ResolvedText {
  if (lang === 'zh') {
    return { text: zh ?? '', needsFallbackIndicator: false };
  }
  // lang === 'en' path:
  if (en !== null && en !== undefined && en.trim().length > 0) {
    return { text: en, needsFallbackIndicator: false };
  }
  return { text: zh ?? '', needsFallbackIndicator: true };
}
