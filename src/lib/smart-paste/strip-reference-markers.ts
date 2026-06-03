/**
 * Strip dangling citation / footnote markers from pasted (or docx-extracted)
 * report text — the " 1", " 3" numbers Gemini Deep Research leaves glued to the
 * end of a sentence after its hyperlinked citations are flattened to plain text.
 *
 * Why a regex and not a docx structural parse: even when the source IS a docx,
 * these markers survive text extraction as plain " 1" (Gemini writes them as
 * superscript / plain-text runs, not as Word <w:footnoteReference> fields), so a
 * structural parse does not remove them. The reliable signal across BOTH the
 * paste path and the docx path is the SAME: a citation number is preceded by a
 * space and sits at a sentence boundary, whereas real data ("第3条", "15%",
 * "3000欧元", "180天") is glued to the preceding character or a unit and never
 * carries a leading space. We key off that one structural difference.
 *
 * Deliberately conservative — it would rather leave a citation than delete a
 * real number. Scope is Chinese-dominant report text (the marker must follow a
 * CJK char, closing bracket, quote, or %), so English "Section 3" / "Top 1" /
 * "Module 2" are never touched.
 *
 * ES-compat note (deployment-environment steering): no lookbehind, no /s flag.
 * The preceding boundary char is a CAPTURE GROUP (re-emitted via $1), not a
 * lookbehind. A trailing lookahead is fine (lookahead is allowed; only
 * lookbehind is restricted on the target).
 */

// boundary char that legitimately precedes a flattened citation marker
const BOUNDARY = '[\\u4e00-\\u9fff%）)】」』”’》〉]';
// optional whitespace (incl. NBSP) + 1-3 digit citation, possibly several (" 1 2")
const MARKER = '[ \\u00a0]+\\d{1,3}(?:[ \\u00a0]+\\d{1,3})*';
// Must be followed by a SENTENCE-ENDING mark or end-of-line. A flattened Gemini
// citation always lands at a clause end ("…控制权 1。", "…审核 1"<EOL>). We
// deliberately EXCLUDE introducing punctuation like "：" "、" "," — those signal
// a heading or list number ("模块 1：", "表 1、") that is real content, not a
// citation. This is the one ambiguous case for a bare leading-space number, and
// we resolve it toward NOT deleting (conservative: keep real, drop only at a
// clause end). The full-width comma "，" is also excluded for the same reason
// (it usually continues the clause, e.g. "条款 1，且…" is rare vs "项目 1，方案 2").
const TRAILING = '(?=[。！？!?；;]|$)';

const REF_MARKER = new RegExp(`(${BOUNDARY})${MARKER}${TRAILING}`, 'gu');

/**
 * Remove dangling citation markers, preserving the boundary char and all real
 * numeric data. Pure and idempotent — running it twice yields the same result.
 */
export function stripReferenceMarkers(text: string): string {
  if (!text) return text;
  // Work line by line so a marker at a true end-of-line is caught by the
  // `$` branch of TRAILING without bleeding across lines.
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(REF_MARKER, '$1'))
    .join('\n');
}
