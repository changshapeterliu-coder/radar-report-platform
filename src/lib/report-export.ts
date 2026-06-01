/**
 * Pure, DOM-free helpers for the report viewer's Quip-style layout and
 * client-side `window.print()` PDF export.
 *
 * Everything here is deterministic and side-effect free (no DOM, no React,
 * no Supabase) so it can be unit- and property-tested without a browser.
 * The viewer (`ReportViewerClient`) consumes these to derive the outline /
 * anchor section list, the print-dialog document-title base, and the export
 * availability gate.
 *
 * Compatibility: regex here is ES2017-safe — simple character classes only,
 * no lookbehind, no `/s` dotAll flag, no named groups (see
 * `.kiro/steering/deployment-environment.md`).
 */

/**
 * One entry in the report outline / one anchored body section.
 * `id` is the shared anchor scheme (`module-${index}`) used by both the
 * sidebar outline and the `<section>` anchors so the two cannot drift.
 */
export interface Section {
  /** Anchor id, `module-${index}`. */
  id: string;
  /** Module title in the currently viewed language. */
  title: string;
}

/** Characters illegal in Windows/macOS filenames + ASCII control chars (0x00–0x1F). */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001F]/g;

/** Runs of whitespace, collapsed to a single space. */
const WHITESPACE_RUN = /\s+/g;

/** Reasonable cap so a derived filename stays manageable across platforms. */
const MAX_FILENAME_LENGTH = 120;

/**
 * Derive the outline / anchor section list from the display modules.
 *
 * Returns exactly one {@link Section} per module, in index order, where the
 * i-th section is `{ id: \`module-${i}\`, title: modules[i].title }`. An empty
 * input yields an empty output. This single derived list drives both the
 * outline entries and the body `<section id>` anchors.
 */
export function deriveSections(modules: { title: string }[]): Section[] {
  return modules.map((m, i) => ({ id: `module-${i}`, title: m.title }));
}

/**
 * Sanitize an arbitrary string into a cross-OS-safe filename fragment:
 * strip filename-illegal characters, collapse whitespace, trim, and cap
 * length. May return an empty string (caller decides on a fallback).
 */
function sanitizeFilename(value: string): string {
  return value
    .replace(ILLEGAL_FILENAME_CHARS, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim()
    .slice(0, MAX_FILENAME_LENGTH);
}

/**
 * Produce a best-effort, cross-OS-safe filename base for the print dialog's
 * default filename (set via `document.title` around `window.print()`).
 *
 * Combines `title` + `dateRange`, strips characters illegal on Windows/macOS
 * (`\ / : * ? " < > |` and ASCII control chars), collapses whitespace, trims,
 * and caps length. When the combined result is empty or whitespace-only
 * (e.g. blank title and dateRange), falls back to a value derived from
 * `reportId` (`report-${reportId}`, sanitized the same way). Never returns
 * an empty string.
 */
export function deriveFilenameBase(args: {
  title: string;
  dateRange: string;
  reportId: string;
}): string {
  const { title, dateRange, reportId } = args;

  const combined = sanitizeFilename(`${title} ${dateRange}`);
  if (combined.length > 0) return combined;

  const fallback = sanitizeFilename(`report-${reportId}`);
  if (fallback.length > 0) return fallback;

  // reportId itself was empty/all-illegal — guarantee a non-empty result.
  return 'report';
}

/**
 * Export availability gate. Export is allowed only for published reports.
 *
 * `isAdmin` is accepted for signature stability but does not widen access —
 * draft/admin export is explicitly out of scope (matches the
 * `EmailReportButton` published-only gate).
 */
export function canExport(status: string, isAdmin: boolean): boolean {
  void isAdmin;
  return status === 'published';
}
