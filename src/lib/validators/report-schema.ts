import { z } from 'zod';
import type { ReportContent } from '@/types/report';

/**
 * ── Zod schemas for v4 Markdown-hybrid ReportContent ──
 *
 * These schemas enforce the structured parts (topTopics / topTools /
 * topEducationOpps) at runtime with Zod. The `markdown` field is treated
 * as free text — only required to be a string.
 *
 * Use cases:
 *   1. Stage 4 Assembler output validation → if invalid, retry LLM.
 *   2. Synthesizer output validation → same.
 *   3. Admin save-draft pre-check (Editor) → surface errors before DB write.
 *
 * Legacy fields (blocks / tables / analysisSections / highlightBoxes)
 * are intentionally *not* validated here — they are considered deprecated
 * and only kept in the type definitions for backward compatibility with
 * pre-v4 drafts.
 */

export const SeverityLevelSchema = z.enum(['high', 'medium', 'low']);

export const SentimentSchema = z.enum([
  'positive',
  'neutral',
  'negative',
  'mixed',
]);

export const TopTopicSchema = z.object({
  rank: z.string().min(1),
  topic: z.string().min(1),
  voice_volume: z.number().nonnegative(),
  keywords: z.array(z.string()).max(10),
  seller_discussion: z.string(),
  severity: SeverityLevelSchema,
  cross_engine_confirmed: z.boolean().optional(),
});

export const TopToolSchema = z.object({
  tool_name: z.string().min(1),
  sentiment: SentimentSchema,
  voice_volume: z.number().nonnegative(),
  key_feedback_points: z.array(z.string()).max(10),
});

export const TopEducationOppSchema = z.object({
  rank: z.string().min(1),
  theme: z.string().min(1),
  target_audience: z.string(),
  urgency: SeverityLevelSchema,
  recommended_format: z.array(z.string()).max(10),
});

/**
 * A v4 module has `title` + `markdown` required, plus optional structured
 * fields that depend on which module it is (topTopics for suspension/listing,
 * topTools for tool feedback, topEducationOpps for education).
 */
export const ReportModuleV4Schema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  markdown: z.string(),
  topTopics: z.array(TopTopicSchema).max(10).optional(),
  topTools: z.array(TopToolSchema).max(20).optional(),
  topEducationOpps: z.array(TopEducationOppSchema).max(10).optional(),
});

export const ReportContentV4Schema = z.object({
  title: z.string().min(1),
  dateRange: z.string().min(1),
  modules: z.array(ReportModuleV4Schema),
});

export type ReportContentV4 = z.infer<typeof ReportContentV4Schema>;

// ──────────────────────────────────────────────────────────
// Format-as-diagnostics helpers — useful for LLM retry feedback
// ──────────────────────────────────────────────────────────

export interface SchemaParseFailure {
  ok: false;
  errors: Array<{ path: string; message: string }>;
}

export interface SchemaParseSuccess {
  ok: true;
  data: ReportContentV4;
}

export type SchemaParseResult = SchemaParseSuccess | SchemaParseFailure;

/**
 * Parses a raw JSON object against the v4 schema. On failure returns a
 * compact list of path/message errors that can be formatted into a
 * retry prompt for the LLM.
 */
export function parseReportContentStrict(raw: unknown): SchemaParseResult {
  const result = ReportContentV4Schema.safeParse(raw);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  const errors = result.error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '<root>',
    message: issue.message,
  }));
  return { ok: false, errors };
}

/**
 * Formats schema errors into a compact string suitable for feedback to
 * an LLM during a retry. Example:
 *   modules.0.markdown: Required
 *   modules.1.topTopics.0.severity: Invalid enum value
 */
export function formatSchemaErrorsForPrompt(
  errors: SchemaParseFailure['errors']
): string {
  return errors
    .slice(0, 20) // cap to avoid exploding prompt
    .map((e) => `  ${e.path}: ${e.message}`)
    .join('\n');
}

/**
 * Runtime check: is this a "v4-shape" module (has markdown field), or a
 * legacy (blocks/tables) module? Renderers use this to branch between
 * MarkdownRenderer and the legacy ReportRenderer path.
 */
export function isMarkdownModule(mod: unknown): boolean {
  if (!mod || typeof mod !== 'object') return false;
  const m = mod as Record<string, unknown>;
  return typeof m.markdown === 'string' && m.markdown.length > 0;
}

/**
 * Runtime check: does this whole ReportContent look like v4?
 * (At least one module has a markdown field.)
 * Used by the top-level ReportRenderer + Dashboard to pick a path.
 */
export function isV4Content(content: ReportContent | null | undefined): boolean {
  if (!content || !Array.isArray(content.modules)) return false;
  return content.modules.some(isMarkdownModule);
}
