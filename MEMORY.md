# MEMORY.md — Radar Report Platform

Append-only decision log. Records *why* things are the way they are, mistakes corrected, and major milestones. Newest entries at the bottom of each section. This is reference, not a rulebook — current rules live in steering/AGENTS.md. Summarize old entries periodically; don't rewrite history.

## How to use this file

- When you make a non-obvious architecture or scope decision, add a dated one-liner: what + why.
- When you cut or defer a feature, log whether it was killed for scope, deferred for sequencing, or rejected on principle.
- When you pick between two valid approaches, log the tradeoff.
- Keep entries short. Link to the spec or migration that carries the detail.

## Architecture decisions

- **Background pipelines on Inngest, not API routes.** Reports take minutes and the user is offline. Inngest gives retries, idempotency, and step durability that raw API routes don't. Cheap to keep; expensive to unwind later.
- **Supabase as the single data + auth layer.** Postgres + RLS + Auth in one. Client / server / service-role split (`src/lib/supabase`) keeps the admin service key off the browser.
- **Two research engines run per report, then compared.** Lets us A/B engine quality (gemini / kimi / GLM / openrouter) without committing to one provider. Engines are interchangeable behind a common interface (`research-engine/engines`).
- **One canonical topic dictionary (`topic_canonicals`) shared across all three pipelines.** Regular report, daily alert, and weekly rankings all classify into the same dictionary so trending is comparable across surfaces. Adding a parallel classifier was rejected on principle — see `unify-topic-dictionary-across-pipelines`.
- **Sequential, append-only migrations.** Never edit an applied migration; add a new numbered file. Keeps every environment reproducible.

## Prompt / quality evolution

- Migrations 011–014: refactored prompts to v3, markdown hybrid synthesizer, aligned engine personas, goal-oriented rewrite. Driver: report quality and consistency across engines.
- Migrations 019–022: rewrote daily scan prompt, added business buckets, post-search bucket filter, aligned daily scan to the weekly report structure. Driver: make daily alerts use the same topic shape as weekly so they aggregate cleanly.
- `prompt-recency-and-persona-alignment` spec: reports were citing content outside the target time window. Fix: tighten recency handling + persona alignment so engines stay on the requested window.

## Bugs corrected (don't regress)

- `draft-report-map-undefined-crash`: draft report rendering crashed on an undefined map — guard added.
- `qwen-engine-thinking-mode-crash`: qwen/thinking-mode engine output broke parsing — handled.
- Bilingual gaps: AI-generated NEWS and older dashboard fields were missing zh/en. Fix: translation sweeper + backfill scripts. Invariant now: every user-facing + AI-generated field is bilingual.
- `format-report` (Smart Paste / AI format) → **markdown-first + deterministic `##`-split.** It was throwing `Expected ',' or '}'` parse errors: stuffing a full verbatim Chinese docx (tables, quotes, newlines) into a JSON string field is the worst case for JSON-string escaping, and the model broke `JSON.parse` mid-string. Fix: the LLM now returns **plain Markdown** (TITLE: / DATERANGE: header lines + `## ` sections), and code assembles `ReportContent` deterministically by splitting on `##` (no LLM, no JSON.parse). This removes the LLM from JSON assembly for the fragile big-content part, so the whole escaping failure class disappears (Principle 2 — architecture over prompt-hope). Safe **only because** Smart Paste sets `topTopics = []` (manual pastes skip topic extraction, so nothing structured needs mining from the prose). Note: auto-run reports do NOT do markdown-first — Stage 4 assembler + synthesizer emit JSON-with-embedded-markdown; they avoid the break only because their markdown chunks are small and built from pre-structured Stage data. Don't "unify" the two paths. File: `src/app/api/ai/format-report/route.ts`. Rejected alternative: `response_format: json_object` + a repair round-trip — repair re-runs the same fragile JSON-string-stuffing, so it lowers the failure rate but doesn't remove it.
- RTL component tests were all silently broken — `@testing-library/dom` (a required peer dep of `@testing-library/react` v16) was missing from `package.json`, so every `.test.tsx` failed to import. Added it pinned (`10.4.1`). Watch this when bumping RTL.

## Milestones

- Core platform shipped: scheduled + on-demand regular reports, dashboard, admin, auth.
- Daily hot topic alert pipeline shipped (`daily-hot-topic-alert` spec, migrations 015–022).
- Weekly topic rankings / trending persisted (migrations 024–027).
- Report publish → email distribution (`report-publish-email-distribution` spec, Resend).
- Report viewer redesigned to a Quip-style three-zone layout (sticky outline + scroll-spy + all modules mounted) with full-report PDF export (`report-view-ui-and-pdf-export` spec).

## Open questions / pending

- Trending requires enough history to be meaningful; needs ≥2 weeks of regular reports before it renders. Confirm the UX when history is thin.
- Specific-topic report formatting varies by topic shape — layout flexibility still being tuned.

## Architecture decisions (cont.)

- **Weekly trending has no standalone pipeline.** Rankings are persisted synchronously inside the publish route (`PUT /api/reports/[id]/publish` → `runCanonicalizeBlock` → `persistWeeklyTopicRankings`), not on a cron. `topic-rankings/scan.ts` transforms the report's `modules[].topTopics` rather than scanning the web, and it reuses the daily `daily_canonicalization_prompt`. Tradeoff: simpler (no extra scheduler, rankings always reflect the published report) but the canonicalize/persist failure is swallowed behind a 200 — an empty trend chart is silent. Watch publish logs for `inserted=N`.
- **Dashboard trend chart render gate.** `DashboardClient.tsx` only renders the trend chart when there are ≥2 distinct `week_label` values and ≥1 non-null `canonical_topic_key`; there is no thin-history empty state, so "not enough history" and "persist failed" look identical in the UI. Note: manual reports can store `week_label` as null, which buckets all rows into one label and also blanks the chart.
- **Report viewer mounts all modules at once (Quip layout), not one tab.** Replaced the tab-switch viewer (only the active module was in the DOM) with a sticky-outline + scroll-spy + all-sections-mounted layout, applied to both regular and topic reports. Why this shape: it's the mechanism that fixes per-theme-only PDF export — `window.print()` only captures what's in the DOM, so all-mounted = whole-report export for free. Client-only refactor, no data-layer change; export stays `window.print()` (server headless deferred). Disclaimer prints as a closing `.print-only` block; per-section ErrorBoundary so one bad module doesn't blank the report. Files: `ReportViewerClient.tsx`, `ReportOutline.tsx`, `ExportPdfButton.tsx`, `src/lib/report-export.ts`. See `report-view-ui-and-pdf-export` spec.