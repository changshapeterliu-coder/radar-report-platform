# Requirements Document

## Introduction

This feature covers two related changes to the **report view page** — the page a reader
opens at `/reports/[id]` to read a published radar report. It bundles two sub-features:

- **(A) Report-view UI refinements** — improvements to how a published report is presented
  to readers (layout, readability, navigation between modules, presentation of the
  structured Top-Topics table and callouts).
- **(B) Export PDF** — letting a reader download the report they are viewing as a PDF file.

### Grounding in the current implementation (read before reviewing)

The current page is already built, so several requirements below are **refinements of
existing behavior**, not greenfield. Reviewers should know the starting state:

- The viewer is `src/app/(main)/reports/[id]/page.tsx` (Server Component) →
  `ReportViewerClient.tsx` → `ReportRenderer.tsx` → `MarkdownRenderer.tsx` /
  `TopTopicsTable.tsx`. Today modules are rendered through `ModuleTabs`, **one module at a
  time** (`activeModule = modules[activeTab]` — only the selected tab is mounted in the
  DOM). **This tab model is being retired.** The decided direction (see Requirement 4) is a
  Quip / Notion-style three-zone reading layout: a sticky left outline plus a single
  scrolling main body in which every module is mounted at once as an anchored section.
- An **"Export PDF" button already exists** in the viewer header. It calls
  `window.print()`, and `globals.css` has a `@media print` block that hides `nav` /
  `.no-print` / buttons and forces a white background. **Because only the active tab is
  mounted today, the current print captures only the selected module, not the whole
  report.** Once every module is mounted simultaneously in the new layout, `window.print()`
  naturally captures the full report — that is precisely why the layout change is the
  enabler for sub-feature (B). Closing this gap is the core of sub-feature (B).
- Language is a single global switch (`i18n.language` via react-i18next). The viewer
  already resolves the displayed language through `getDisplayReportContent` /
  `getDisplayReportTitle` / `getDisplayReportDateRange` in `src/lib/content-display.ts`,
  which prefer `content_translated` (en) and fall back to `content` (zh).
- The header right-slot today holds the Export PDF button and an **admin-only**
  `EmailReportButton` (renders only when `isAdmin && status === 'published'`).
- The UI design system (`.kiro/steering/ui-design-system.md`) is a hard contract:
  Amazon-orange `#ff9900` accent used sparingly, neutral grays, Inter / PingFang font
  stack, lucide icons (never emoji in chrome), `Badge` severity variants, `rounded-lg`
  cards, at most one `primary` button per screen, `outline` variant for export-type
  actions.
- Deployment is Vercel serverless (hobby 10s / pro 60s per route; no filesystem writes
  beyond `/tmp`). The export mechanism for this spec is **decided: client-side
  `window.print()`** (the browser's print-to-PDF dialog), reusing and extending the
  existing `@media print` stylesheet in `globals.css`. The Quip layout (all modules mounted
  at once) is what makes `window.print()` capture the whole report, so no server-side
  headless renderer is needed for this spec. Tradeoff noted: `window.print()` uses the
  browser's native dialog and the output fidelity and final filename depend on the user's
  browser; a server-side headless render would give higher fidelity and a controlled
  filename but adds serverless complexity — that path is **explicitly deferred and out of
  scope** for this spec.

### Scope notes

- **The report-view UI direction is now decided** (Quip / Notion-style three-zone reading
  layout). Requirements R1–R4 reflect that decision: R2 and R4 describe the sticky-sidebar
  + scroll-jump + scroll-spy model that replaces the tab model.
- **The Reading_Layout applies to BOTH report types** — one viewer, no per-type fork. A
  `regular` report (4 fixed canonical modules: "Account Suspension Trends", "Listing
  Takedown Trends", "Account Health Tool Feedback", "Education Opportunities") and a `topic`
  report (1–N modules) both render through the same Quip layout; the Sidebar_Outline simply
  lists whichever modules that report has.
- **Export preserves the full on-screen rendering, not a degraded text-only version.** The
  PDF retains the Top_Topics_Table with severity Badge colors, the colored callouts with
  their icons, GFM tables, headings, lists, Chinese line-height, and Design_System tokens —
  because `window.print()` prints the already-rendered DOM, not a re-extracted text copy.
  Only interactive chrome is stripped.
- **Export includes the disclaimer.** The platform's canonical bilingual disclaimer
  (`src/lib/disclaimer.ts` via `DisclaimerBanner` / `getDisclaimer`) must appear in the
  exported PDF. Reuse the existing text — do not author a new disclaimer.
- Requirements describe **what** the reader experiences and the constraints the solution
  must honor. Component-level implementation detail belongs in the design document.

## Glossary

- **Report_View_Page**: The reader-facing page at `/reports/[id]` that renders a single
  report in the Reading_Layout, composed of `ReportViewerClient`, `ReportRenderer`,
  `MarkdownRenderer`, and `TopTopicsTable`.
- **Report_Module**: One section of a report (`ReportModule` in `src/types/report.ts`),
  rendered as an Anchored_Section. A module may carry v4 `markdown` plus structured
  `topTopics` / `topTools` / `topEducationOpps`, or legacy `blocks` / `tables`.
- **Report_Type**: Either `regular` (4 fixed canonical modules) or `topic` (1–N modules).
  The Reading_Layout is identical for both; only the module list differs.
- **Reading_Layout**: The Quip / Notion-style three-zone layout of the Report_View_Page:
  a sticky Sidebar_Outline on the left and a single scrolling main body on the right in
  which every Report_Module is mounted at once. Applies to both Report_Types.
- **Sidebar_Outline**: The sticky navigation control listing the report's Report_Modules
  (1–6 of them) as clickable outline entries. Replaces the retired tab control. On narrow
  screens it collapses into a top dropdown/drawer.
- **Anchored_Section**: A Report_Module rendered as an anchor-addressable section in the
  main body. All Anchored_Sections are present in the DOM simultaneously.
- **Scroll_Jump**: The behavior where activating a Sidebar_Outline entry scrolls the main
  body to the corresponding Anchored_Section (anchor navigation), rather than switching a
  tab.
- **Scroll_Spy**: The behavior where the Sidebar_Outline highlights the Report_Module whose
  Anchored_Section is currently in view as the Reader scrolls the main body.
- **Top_Topics_Table**: The structured Top-N table (`TopTopicsTable`) rendered at the top
  of a module from `topTopics[]`.
- **Viewed_Language**: The language currently selected by the global language switch
  (`i18n.language`), resolved to `zh` or `en`, that determines which stored content
  version (`content` vs `content_translated`) the page renders.
- **PDF_Export**: The capability that produces a downloadable PDF document of the report
  currently being viewed, using the browser's client-side `window.print()` print-to-PDF
  dialog.
- **Export_Control**: The user-facing button that initiates PDF_Export.
- **Published_Report**: A report whose `status` is `published`.
- **Draft_Report**: A report whose `status` is not `published` (e.g. `draft`).
- **Reader**: Any authenticated user viewing the Report_View_Page.
- **Admin**: A user whose profile role is admin (`isAdmin` from the role hook).
- **Design_System**: The visual and interaction contract in
  `.kiro/steering/ui-design-system.md`.
- **Disclaimer**: The platform's canonical bilingual legal notice defined in
  `src/lib/disclaimer.ts` (`getDisclaimer(lang)` → `DISCLAIMER_ZH` / `DISCLAIMER_EN`),
  surfaced on screen by `DisclaimerBanner`.

## Requirements

### Requirement 1: Report content readability and presentation

**User Story:** As a Reader, I want a published report to be presented in a clean, readable
layout, so that I can absorb compliance trends without visual friction.

#### Acceptance Criteria

1. THE Report_View_Page SHALL render report content using the Design_System tokens for
   color, typography, spacing, and card conventions.
2. WHERE a Report_Module contains Chinese paragraph text, THE Report_View_Page SHALL render
   that text with a line height of at least `leading-relaxed` (1.625).
3. THE Report_View_Page SHALL constrain article-body text to a bounded reading measure so
   that no body line exceeds the Design_System reading-width convention.
4. THE Report_View_Page SHALL render section callouts (insight, warning, recommendation,
   stat, quote) with lucide icons rather than emoji.
5. THE Report_View_Page SHALL render the report title, report type, and date range in the
   page header.

### Requirement 2: Module navigation via sticky outline and scroll-jump

**User Story:** As a Reader, I want a sticky outline of the report's sections that jumps me
to the part I care about while keeping every section on one scrolling page, so that I can
move around without losing the rest of the report.

#### Acceptance Criteria

1. WHEN a report contains more than one Report_Module, THE Report_View_Page SHALL display
   the Sidebar_Outline listing every Report_Module title.
2. THE Report_View_Page SHALL apply the Reading_Layout uniformly to both Report_Types — a
   `regular` report's 4 canonical modules and a `topic` report's 1–N modules render through
   the same layout, sidebar, and scroll behavior, with no per-type code fork.
3. THE Report_View_Page SHALL mount every Report_Module as an Anchored_Section in the main
   body simultaneously, so that all module content is present in the DOM at once.
4. WHEN a Reader activates a Report_Module entry in the Sidebar_Outline, THE Report_View_Page
   SHALL Scroll_Jump the main body to that module's Anchored_Section.
5. WHILE the Reader scrolls the main body, THE Report_View_Page SHALL apply Scroll_Spy to
   highlight the Sidebar_Outline entry whose Anchored_Section is currently in view, using the
   Design_System active indicator.
6. WHEN a report contains exactly one Report_Module, THE Report_View_Page SHALL render that
   module's Anchored_Section without requiring Sidebar_Outline interaction.

### Requirement 3: Structured Top-Topics presentation

**User Story:** As a Reader, I want the Top-Topics table to be clear and scannable, so that
I can read severity and ranking at a glance.

#### Acceptance Criteria

1. WHERE a Report_Module contains `topTopics`, THE Report_View_Page SHALL render the
   Top_Topics_Table above that module's narrative body.
2. THE Top_Topics_Table SHALL render each topic's severity using the Design_System severity
   Badge variants (high = danger, medium = warning, low = info).
3. THE Top_Topics_Table SHALL render column headers and severity labels in the
   Viewed_Language.
4. WHERE a topic is cross-engine confirmed, THE Top_Topics_Table SHALL display a confirmation
   indicator on that topic's rank.
5. THE Top_Topics_Table SHALL convey severity through both a text label and color rather
   than color alone.

### Requirement 4: Quip three-zone reading layout

**User Story:** As a Reader, I want the report presented like a Quip / Notion doc — a sticky
outline beside one long scrolling body — so that reading feels natural and I always know
where I am in the report.

#### Acceptance Criteria

1. THE Report_View_Page SHALL present the Reading_Layout with the Sidebar_Outline on the
   left and the report main body to the right of the Sidebar_Outline.
2. WHILE the Reader scrolls the main body, THE Report_View_Page SHALL keep the
   Sidebar_Outline fixed in place (sticky).
3. THE Sidebar_Outline SHALL list the report's Report_Modules (1 to 6) as clickable outline
   entries rendered in the Viewed_Language.
4. THE Report_View_Page SHALL use this same Reading_Layout for both a `regular` report
   (listing its 4 canonical modules) and a `topic` report (listing its 1–N modules).
5. WHEN a Reader activates a Sidebar_Outline entry, THE Report_View_Page SHALL Scroll_Jump to
   the corresponding Anchored_Section rather than performing a tab switch.
6. WHILE the Reader scrolls the main body, THE Report_View_Page SHALL apply Scroll_Spy to
   mark the Sidebar_Outline entry for the Anchored_Section currently in view as active, using
   the Design_System active indicator.
7. WHERE the viewport is too narrow to show the Sidebar_Outline beside the main body, THE
   Report_View_Page SHALL collapse the Sidebar_Outline into a top dropdown control and give
   the main body the full viewport width.
8. WHEN a Reader selects a Report_Module from the collapsed top dropdown control, THE
   Report_View_Page SHALL Scroll_Jump to that module's Anchored_Section and then collapse the
   dropdown control.

### Requirement 5: Initiate PDF export

**User Story:** As a Reader, I want a clear way to export the report I am reading as a PDF,
so that I can save it or share it offline.

#### Acceptance Criteria

1. THE Report_View_Page SHALL display an Export_Control in the page header.
2. THE Export_Control SHALL use the Design_System `outline` button variant with a lucide
   icon and a label rendered in the Viewed_Language.
3. WHEN a Reader activates the Export_Control, THE Report_View_Page SHALL invoke the
   browser's client-side `window.print()` print-to-PDF flow for the report currently being
   viewed.
4. THE Report_View_Page SHALL present at most one `primary` button in the header, and the
   Export_Control SHALL NOT be that `primary` button.

### Requirement 6: PDF completeness — full report, all modules in one export

**User Story:** As a Reader, I want one export action to produce a single PDF containing the
whole report, so that the file is not missing the sections I did not have open on screen.

> This fixes the current behavior, where export captures only the active module (the
> per-theme-only export). Because the Reading_Layout mounts every Report_Module as an
> Anchored_Section in the DOM at once, a single `window.print()` captures the full report.

#### Acceptance Criteria

1. WHEN PDF_Export runs, THE PDF_Export SHALL produce a single PDF that includes every
   Report_Module of the report in document order.
2. THE PDF_Export SHALL rely on every Report_Module being mounted in the DOM as an
   Anchored_Section at export time, so that no module is omitted regardless of the
   Scroll_Spy active state.
3. THE PDF_Export SHALL include each module's narrative body, callouts, and any rendered
   tables.
4. WHERE a Report_Module contains a Top_Topics_Table, THE PDF_Export SHALL include that
   table for that module.
5. THE PDF_Export SHALL include the report title, report type, and date range.
6. THE PDF_Export SHALL include the Disclaimer, rendered in the Viewed_Language using the
   platform's canonical disclaimer text (`getDisclaimer`), so the legal notice is present in
   the saved/shared file.
7. THE PDF_Export SHALL exclude interactive page chrome (site navigation, the
   Sidebar_Outline control, the Export_Control itself, and other action buttons) from the
   generated PDF.

### Requirement 7: PDF bilingual fidelity

**User Story:** As a Reader who switched the interface to a chosen language, I want the PDF to
come out in that same language, so that the export matches what I was reading.

#### Acceptance Criteria

1. WHEN PDF_Export runs while the Viewed_Language is English, THE PDF_Export SHALL render the
   report content from the English version where an English version is available.
2. WHEN PDF_Export runs while the Viewed_Language is Chinese, THE PDF_Export SHALL render the
   report content from the Chinese version.
3. IF the Viewed_Language is English AND no English version of a content element exists, THEN
   THE PDF_Export SHALL fall back to the Chinese version of that element, consistent with the
   on-screen fallback behavior.
4. THE PDF_Export SHALL render fixed labels (column headers, severity labels, callout labels)
   in the Viewed_Language.

### Requirement 8: PDF fidelity to on-screen rendering

**User Story:** As a Reader, I want the PDF to look like the report I saw on screen, so that
the export is trustworthy and on-brand.

#### Acceptance Criteria

1. THE PDF_Export SHALL render report content using the Design_System color tokens,
   typography, and severity Badge styling.
2. THE PDF_Export SHALL preserve table structure (headers and rows) for any table included
   in the report.
3. THE PDF_Export SHALL avoid splitting a single table row across two pages.
4. THE PDF_Export SHALL flow the Anchored_Sections top-to-bottom in document order so that
   the print layout reads as one continuous report rather than separate per-module exports.
5. WHERE Chinese paragraph text appears in the PDF, THE PDF_Export SHALL preserve the relaxed
   line height used on screen.

### Requirement 9: PDF filename (best effort)

**User Story:** As a Reader, I want the downloaded PDF to have a recognizable name, so that I
can find it later among other files.

> Because export uses `window.print()`, the final filename is controlled by the browser's
> print dialog and cannot be set programmatically. These criteria are therefore best-effort:
> the page influences the default filename through the document title.

#### Acceptance Criteria

1. WHEN a Reader initiates PDF_Export, THE Report_View_Page SHALL set the document title to a
   value derived from the report title and date range so the browser's print dialog proposes
   it as the default filename.
2. THE Report_View_Page SHALL derive that document-title value using only characters valid
   for filenames across Windows and macOS.
3. WHERE the report title is empty, THE Report_View_Page SHALL derive the document-title
   value from the report identifier.
4. WHEN PDF_Export completes or is dismissed, THE Report_View_Page SHALL restore the document
   title to its prior value.

### Requirement 10: Export states — preparation, hand-off, failure

**User Story:** As a Reader, I want to know whether the export is working, so that I am not
left guessing when I click export.

> With `window.print()`, the browser's print dialog handles the actual PDF generation and
> save. The Report_View_Page is responsible for preparing the print view and handing off to
> the dialog, not for tracking generation progress inside the dialog.

#### Acceptance Criteria

1. WHILE the Report_View_Page is preparing the print view and opening the print dialog, THE
   Report_View_Page SHALL show a busy indication on the Export_Control and prevent a second
   concurrent activation.
2. WHEN the Report_View_Page has handed off to the browser print dialog, THE
   Report_View_Page SHALL return the Export_Control to its ready state.
3. IF preparing the print view fails before the print dialog opens, THEN THE
   Report_View_Page SHALL show the Reader an error message in the Viewed_Language and
   re-enable the Export_Control.

### Requirement 11: Export access and report status

**User Story:** As the product owner, I want PDF export available to the right audience on the
right reports, so that exports stay consistent with how reports are shared.

#### Acceptance Criteria

1. WHEN a Reader views a Published_Report, THE Report_View_Page SHALL make the Export_Control
   available.
2. THE product owner SHALL confirm whether a Draft_Report can be exported, and WHERE export of
   a Draft_Report is not permitted, THE Report_View_Page SHALL hide the Export_Control for a
   Draft_Report.
3. WHERE export of a Draft_Report is permitted for an Admin, THE Report_View_Page SHALL make
   the Export_Control available to an Admin on a Draft_Report.
4. THE PDF_Export SHALL only export reports the Reader is already authorized to view.

### Requirement 12: Export responsiveness

**User Story:** As a Reader, I want the export to feel responsive, so that I am not stuck
waiting after I click export.

> Export runs entirely client-side through `window.print()`; there is no server-side render
> path in scope, so deployment per-request execution limits do not apply to the export
> itself.

#### Acceptance Criteria

1. WHEN a Reader activates the Export_Control, THE Report_View_Page SHALL acknowledge the
   action within 1 second by entering the busy state.
2. WHEN the print view is prepared, THE Report_View_Page SHALL open the browser print dialog
   without requiring a server round-trip.
