/**
 * Whitelisted prompt-placeholder substitution for the daily-alert prompts.
 *
 * Why a whitelist:
 *   Admin-edited prompts (stored in `prompt_templates`) are free-form Chinese
 *   text with `{placeholder}` tokens. A naive `replace(/\{(\w+)\}/g, ...)`
 *   would happily expand any token the admin happens to type — e.g. a prompt
 *   that talks about `{users}` would get `{users}` substituted as empty.
 *   Worse, if future code were to ever pass user-controlled strings to
 *   `substitute()`, a full-open expander would be a mild injection vector.
 *
 *   We bound behavior: only the 5 known placeholder keys below are
 *   expanded; anything else is left literal in the output.
 *
 * No `eval`, no `Function`, no dynamic resolution beyond string.replace.
 *
 * Spec refs:
 *   Requirements: 4.2, 12.5, 12.6, 13.1
 *   Design:       §scan.ts / §canonicalize.ts
 */

/** Placeholder keys recognized by `substitute()`. */
export const ALLOWED_PLACEHOLDERS = [
  'coverage_window_start',
  'coverage_window_end',
  'domain_name',
  'scanned_topics_json',
  'existing_canonicals_json',
] as const;

export type AllowedPlaceholder = (typeof ALLOWED_PLACEHOLDERS)[number];

const ALLOWED_SET: ReadonlySet<string> = new Set(ALLOWED_PLACEHOLDERS);

/**
 * Replace `{placeholder}` tokens in `template` using `vars`. Unknown
 * placeholders are left as-is. Missing known placeholders are substituted
 * with empty string (intentional — prompt editor may include
 * `{domain_name}` but caller may omit it).
 *
 * Only placeholder keys in `ALLOWED_PLACEHOLDERS` are recognized; anything
 * else is returned literally, even if present in `vars`. This is a
 * whitelist and is intentional.
 */
export function substitute(template: string, vars: Partial<Record<AllowedPlaceholder, string>>): string {
  return template.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (match, key: string) => {
    if (!ALLOWED_SET.has(key)) {
      // Unknown key — preserve verbatim so admin typos / prompt content
      // containing literal `{foo}` examples are not silently eaten.
      return match;
    }
    const value = vars[key as AllowedPlaceholder];
    return value ?? '';
  });
}
