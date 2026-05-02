# Bugfix Requirements Document

## Introduction

After the latest Vercel deploy (v4 Markdown-hybrid landed in commits
`a579c27` / `b90d67a` / `bf0903c`), the production bundle throws
`Uncaught TypeError: Cannot read properties of undefined (reading 'map')`
when the user opens a draft report page (`/reports/<id>`). The stack
trace points at `Array.map` called from a minified React component —
the client-side rendering pipeline crashes before the page is painted.

This is the third instance in the same family of bugs that already hit
us twice in TASK 1:

1. `r.cells is undefined` in `normalizeRow()` — v3 AI produced row
   objects without a `cells` array. Fixed by an `Object.values()`
   fallback.
2. `undefined.map` in `ContentEditor.tsx` — edit page read
   `module.tables`/`analysisSections`/`highlightBoxes` without `?? []`
   guards when v3 AI emitted only a `blocks` array. Fixed by adding
   the guards.

The pattern is always the same: a `.map()` call on an array field
that TypeScript *types as present* but that real-world data (AI
output, legacy v3 drafts, partial admin edits) can leave `undefined`.

Audit of `src/components/report/ReportRenderer.tsx` shows two
remaining unguarded call sites in the **legacy v3 dispatch path**,
inside `AnalysisSectionRenderer`:

- Line 198 — `section.quotes.map(...)` (crashes if `quotes` is
  undefined)
- Line 204 — `section.keyPoints.length > 0` followed by
  `section.keyPoints.map(...)` (the `.length` access itself crashes
  before `.map` runs, but both are unsafe)

Impact: any draft or published report whose content has at least one
legacy `AnalysisSection` missing its `quotes` or `keyPoints` field
will crash the reader page. The Error Boundary in
`src/app/(main)/reports/[id]/page.tsx` will catch the throw and fall
back to a raw-JSON dump — but the user sees a broken experience
instead of the report. If the crash happens higher in the tree (the
renderer is inside the boundary, so this is actually caught), the
page shows the raw-JSON fallback; if the crash was outside the
boundary the page would show Next.js's default error screen ("this
page couldn't load"), which is what the user is reporting.

## Bug Analysis

### Current Behavior (Defect)

When the reader page renders a legacy v3 module whose
`analysisSections` array contains at least one section with a
missing `quotes` or `keyPoints` field, `AnalysisSectionRenderer`
throws `TypeError: Cannot read properties of undefined (reading
'map')` while evaluating `section.quotes.map(...)` (or the same
error on `'length'` for `keyPoints`). The throw aborts the React
render for the entire page.

1.1 WHEN a report's `ReportContent` contains a legacy
    `ReportModule` (no `markdown` field) whose
    `analysisSections[i].quotes` is `undefined` THEN the system
    throws `TypeError: Cannot read properties of undefined
    (reading 'map')` from `AnalysisSectionRenderer` and the
    reader page fails to render.

1.2 WHEN a report's `ReportContent` contains a legacy
    `ReportModule` whose `analysisSections[i].keyPoints` is
    `undefined` THEN the system throws `TypeError: Cannot read
    properties of undefined (reading 'length')` from
    `AnalysisSectionRenderer` and the reader page fails to
    render.

### Expected Behavior (Correct)

The renderer must be defensive against malformed legacy shapes,
matching the pattern already used for `tables`,
`analysisSections`, `highlightBoxes`, and `BlockRenderer`'s
`stats`/`items` (`(field ?? []).map(...)`). A missing `quotes` or
`keyPoints` field should render as "no quotes / no key points" —
i.e. skipped — not as a crash.

2.1 WHEN a report's `ReportContent` contains a legacy
    `ReportModule` whose `analysisSections[i].quotes` is
    `undefined` THEN the system SHALL render the analysis
    section with zero quotes (no crash) and continue rendering
    the rest of the report.

2.2 WHEN a report's `ReportContent` contains a legacy
    `ReportModule` whose `analysisSections[i].keyPoints` is
    `undefined` THEN the system SHALL render the analysis
    section with zero key points (no crash) and continue
    rendering the rest of the report.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a report is v4 (module has non-empty `markdown`) THEN
    the system SHALL CONTINUE TO render via
    `MarkdownModuleCard` (TopTopicsTable + MarkdownRenderer),
    unchanged.

3.2 WHEN a legacy module has a well-formed
    `analysisSections[i]` with both `quotes: Quote[]` and
    `keyPoints: KeyPoint[]` populated THEN the system SHALL
    CONTINUE TO render quotes via `QuoteRenderer` and key
    points via `KeyPointRenderer`, unchanged.

3.3 WHEN a legacy module has a well-formed `tables` array
    THEN the system SHALL CONTINUE TO render tables via the
    existing `TableRenderer` + `normalizeRow` path (the TASK 1
    fix), unchanged.

3.4 WHEN a legacy module has `analysisSections: undefined`
    at the module level THEN the system SHALL CONTINUE TO
    render the module without analysis sections (the existing
    `(module.analysisSections ?? []).map(...)` guard stays).
