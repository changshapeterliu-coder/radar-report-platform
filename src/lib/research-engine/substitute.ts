/**
 * Safe placeholder replacement for prompt templates.
 *
 * Replaces `{key}` tokens with values from `vars`, but ONLY for keys
 * that appear in ALLOWED_KEYS. Unknown `{foo}` tokens are left
 * untouched — this is intentional so that accidental LLM-generated
 * brace content in prompts stays verbatim.
 *
 * Intentionally does NOT use `eval`, `new Function`, template literal
 * execution, or any dynamic code evaluation. Pure string substitution.
 */
export const ALLOWED_KEYS = [
  'start_date',
  'end_date',
  'week_label',
  'domain_name',
  'gemini_output',
  'kimi_output',
  'subquestion',
  'channel_profile',
  // Deep-researcher specific (Stage 4):
  'topic',
  'module',
  'keywords',
] as const;

export type AllowedKey = (typeof ALLOWED_KEYS)[number];

const ALLOWED_SET = new Set<string>(ALLOWED_KEYS);

export function substitute(
  template: string,
  vars: Partial<Record<AllowedKey, string>>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (!ALLOWED_SET.has(key)) {
      // Unknown key — keep the original `{key}` token verbatim.
      return match;
    }
    const value = vars[key as AllowedKey];
    // If the key is allowed but no value provided, also keep verbatim.
    return value === undefined ? match : value;
  });
}
