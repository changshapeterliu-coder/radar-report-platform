# Implementation Plan: Smart Paste Topic Extraction

## Overview

Add an additive, best-effort Layer-2 topic extraction step to Smart Paste so a
manually-pasted regular report produces structured `topTopics[]` (from a table
**or** prose) and flows through the unchanged publish-time pipeline (one topic
dictionary, idempotent runs — per AGENTS.md). Plus give a report's AI Insight
news the same `report_id` ownership `topic_rankings` already has, so re-publish
replaces (not appends) and delete cascades.

Implementation language: **TypeScript** (the design's Components and Interfaces
section is TypeScript; no pseudocode). Tests use **vitest**; property-based tests
use **fast-check** (already a devDependency).

The build order is: data layer → pure correctness core (with property tests) →
LLM-call wrapper → wire Layer 2 into the route → strip the transient `extraction`
field in the two editor consumers → publish-route ownership refactor → pipeline
reuse + parity verification. Each step builds on the previous and ends wired in;
no orphaned code.

## Tasks

- [x] 1. Data layer — `news.report_id` ownership column
  - [x] 1.1 Create `supabase/migrations/028_add_news_report_id.sql`
    - Add `news.report_id UUID NULL REFERENCES reports(id) ON DELETE CASCADE`
    - Add `CREATE INDEX idx_news_report_id ON news(report_id)`
    - NULL-able (curated `/api/news` rows have no originating report); cascade is
      DB-engine enforced so it fires through the user-scoped delete client
    - Follow the 026/027 verification + rollback comment-block convention
    - _Requirements: 9.2, 9.3_

- [x] 2. Extraction correctness core — `src/lib/smart-paste/extract-top-topics.ts` (pure, code-owned)
  - [x] 2.1 Implement the pure correctness functions
    - Define `RawTopicCandidate` (all fields optional), `DEFAULT_SEVERITY = 'medium'`,
      `MAX_TOPICS_PER_MODULE = 10`, `MAX_KEYWORDS = 10`
    - `coerceSeverity(raw): TopTopic['severity']` — map 高/中/低, 高风险/中风险/低风险,
      high/medium/low; undeterminable → `DEFAULT_SEVERITY` (never omit)
    - `coerceVoiceVolume(raw): number` — non-numeric / missing / negative → `0`
    - `normalizeExtractedTopics(candidates): TopTopic[]` — coerce fields + apply
      defaults; **drop rows with empty/whitespace `topic`** (code-owned
      no-fabrication rail, no table detector); split/trim/dedupe/cap keywords at
      `MAX_KEYWORDS`; validate each row against `TopTopicSchema` (drop/repair on
      fail); assign `rank` from explicit source numbering when present else
      1-based order of appearance (never re-rank); sort by rank; cap at
      `MAX_TOPICS_PER_MODULE` keeping highest-ranked. Pure, deterministic, idempotent
    - Reuse `TopTopicSchema` from `src/lib/validators/report-schema.ts` and
      `TopTopic` from `src/types/report.ts` — no schema change
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 2.3, 3.1, 3.4, 3.5, 6.1, 6.4_

  - [x]* 2.2 Write property test — schema validity
    - **Property 1: Every extracted topic is a schema-valid TopTopic**
    - **Validates: Requirements 1.2, 6.1, 6.4**
    - `fc.array(rawCandidateArbitrary)` (fields randomly present/absent/wrong-typed);
      assert every `normalizeExtractedTopics` output row passes `TopTopicSchema.safeParse`
    - File `src/lib/smart-paste/__tests__/extract-top-topics.test.ts`, `numRuns: 100`,
      tag comment: `// Feature: smart-paste-topic-extraction, Property 1`

  - [x]* 2.3 Write property test — cap and source-order rank
    - **Property 2: Output is capped at 10, keeping highest-ranked rows, rank is source order**
    - **Validates: Requirements 1.5**
    - `fc.array(validCandidate, { maxLength: 30 })` with some explicit / some absent
      ranks; assert `out.length <= 10`, kept ranks are the smallest, rank follows
      explicit numbering when present else order of appearance (no re-ranking)

  - [x]* 2.4 Write property test — documented defaults always applied
    - **Property 3: Documented defaults are always applied, never omitted**
    - **Validates: Requirements 1.3, 1.4, 3.2, 3.4**
    - `fc.anything()` into `coerceSeverity` (assert ∈ {high,medium,low}) and
      `coerceVoiceVolume` (assert number ≥ 0); candidates missing severity/volume →
      assert `'medium'` / `0`

  - [x]* 2.5 Write property test — no fabrication
    - **Property 4: empty candidate set → [], empty-topic rows dropped (source-shape-independent)**
    - **Validates: Requirements 2.3, 3.5, 5.1**
    - `normalizeExtractedTopics([])` → `[]`; `fc.array(candidateWithEmptyOrWhitespaceTopic)`
      → `[]`; assert every empty-`topic` row is dropped (no table detector involved)

  - [x]* 2.6 Write property test — faithful passthrough
    - **Property 5: Extraction introduces nothing and preserves language**
    - **Validates: Requirements 3.1, 3.3, 3.6**
    - `fc.array(candidate)`; assert every output `topic` ∈ input topics (trimmed),
      output keywords ⊆ input keywords, `out.length <= in.length`, topic text byte-identical

  - [x]* 2.7 Write property test — additive merge never mutates markdown
    - **Property 6: Extraction is additive — the markdown body is never mutated**
    - **Validates: Requirements 1.6, 6.3**
    - `fc.record({ markdown: fc.string(), topTopics: fc.array(topTopicArbitrary) })`;
      assert merging topics into a module leaves `module.markdown` identical
      (`after.markdown === before.markdown`)

  - [x]* 2.8 Write property test — valid rows in produce non-empty topics out
    - **Property 7: Valid rows in produce non-empty topics out**
    - **Validates: Requirements 1.1**
    - `fc.array(candidate)` constrained to include ≥1 non-empty-`topic` row; assert
      output is non-empty

- [x] 3. Extraction LLM-call wrapper (same file, additive)
  - [x] 3.1 Implement `extractTopTopicsForModule({ markdown, apiKey, signal })`
    - One constrained OpenRouter call per module body, then `normalizeExtractedTopics`
    - `response_format: { type: 'json_schema' }` describing `{ topics: RawTopicCandidate[] }`;
      fall back to `json_object` if the route rejects json_schema (API constraint, never prompt-only)
    - System prompt = synthesizer analogue: identify top topics in ANY shape (table,
      prose, bullets, numbered paragraphs); MAY condense but MUST NOT invent topics /
      keywords / numbers; keep original language; preserve source order as `rank`;
      return empty list when genuinely no topic content
    - Bounded `AbortSignal` (~30–45s, interactive). **Never throws** — returns
      `{ topics: [], dropped, failed }` on any failure mode (non-2xx, timeout, empty,
      unparseable JSON, all-rows-dropped); `failed` distinguishes failure from genuine empty
    - _Requirements: 5.2, 5.4, 6.2, 6.3, 6.4_

  - [x]* 3.2 Write example/mock tests for the wrapper (mock `fetch`)
    - File `src/lib/smart-paste/__tests__/extract-top-topics.llm.test.ts`
    - non-2xx → `{ topics: [], dropped: 0, failed: true }`, no throw (R5.2, R5.4)
    - malformed JSON body → `{ topics: [], failed: true }`, no throw (R5.2, R6.1)
    - aborted signal → `{ topics: [], failed: true }`, no throw (R5.2)
    - one invalid + two valid rows → 2 topics, `dropped: 1`, `failed: false` (R6.1, R5.3)
    - valid response, empty topics, no error → `failed: false`, topics `[]` (R5.4)
    - prose-derived candidates (no table in mocked body) → topics produced — confirms
      no table pre-gate (R2.4)
    - request body assertion: includes `response_format` (R6.2)
    - _Requirements: 5.2, 5.4, 6.1, 6.2, 2.4_

- [x] 4. Checkpoint — correctness core verified
  - Ensure all property and wrapper tests pass, ask the user if questions arise.

- [x] 5. Wire Layer 2 into Smart Paste — `src/app/api/ai/format-report/route.ts`
  - [x] 5.1 Add Layer 2 after `buildReportContentFromMarkdown` (Layer 1 unchanged)
    - No table pre-gate: `Promise.allSettled` over `parsed.modules`, calling
      `extractTopTopicsForModule` per module with `AbortSignal.timeout(45_000)`
    - Assign `m.topTopics = ok.topics` (additive; markdown untouched, R1.6); a
      settled-rejected module → `{ topics: [], dropped: 0, failed: true }`
    - Change `ReportModuleLite.topTopics` type from `never[]` to `TopTopic[]`
    - Build `extraction: { perModule[], total }` where each `perModule` carries
      `moduleIndex, title, extracted, dropped, outcome` (`ok`/`empty`/`failed`);
      return as a sibling of `ReportContent` (NOT folded into `content`)
    - Correct the stale "manual pastes skip the topic-extraction pipeline" comment
    - _Requirements: 1.1, 1.6, 2.1, 5.2, 5.3, 5.4_

  - [x]* 5.2 Write regression test — no-topic paste still returns empty topTopics
    - File `src/app/api/ai/__tests__/format-report.test.ts` (mock both LLM layers)
    - Paste whose modules have no topic content → response parses as valid
      `ReportContent` with `topTopics: []` for every module (pre-feature contract held)
    - Assert `extraction.total === sum(perModule.extracted)` consistency
    - _Requirements: 5.1, 5.3_

- [x] 6. Strip the transient `extraction` field in editor consumers + non-blocking notice
  - [x] 6.1 Refactor `src/app/(main)/admin/reports/new/page.tsx` (`handleAiFormat`)
    - Destructure `const { extraction, ...content } = data;` then
      `setContent(content as ReportContent)` so `extraction` never enters editor state
    - Store the summary and render a non-blocking notice: `Extracted N topics across
      M modules`, with per-module `outcome` so `failed` reads differently from `empty`
    - Use existing `bg-primary-soft` / `text-foreground-muted` tokens — no new color
    - _Requirements: 5.3, 5.4_

  - [x] 6.2 Refactor `SmartPasteSection` in `src/components/admin/ContentEditor.tsx`
    - Same `extraction`-stripping fix in `handleFormat`; surface the same count +
      per-module outcome notice so the embedded box behaves identically
    - _Requirements: 5.3, 5.4_

- [x] 7. Publish-time derived-artifact ownership (R9) — `src/app/api/reports/[id]/publish/route.ts`
  - [x] 7.1 Refactor the AI Insight news block only (canonicalize block UNCHANGED)
    - Before generating: `DELETE FROM news WHERE report_id = id AND source_channel =
      'AI Insight'` (idempotent replace, mirrors `persist_weekly_topic_rankings`)
    - Add `report_id: id` to every AI Insight `news` insert (ownership link)
    - Keep the change inside the existing news `try/catch` so an AI Insight failure
      still never blocks the publish 200; leave `runCanonicalizeBlock` and the
      translate-enqueue untouched
    - _Requirements: 9.1, 9.3, 9.4_

- [x] 8. Pipeline-reuse + parity verification
  - [x]* 8.1 Write integration tests for `buildScannedTopicsFromModule` reuse
    - File `src/lib/topic-rankings/__tests__/scan-manual-report.test.ts`
    - Fixture `ReportContent` with extracted `topTopics` in module 0 → returns the
      projected `ScanTopic[]` (manual report no longer invisible) (R4.1)
    - Fixture with **edited** `topTopics` → returns the edited values (R7.3)
    - Fixture with `topTopics: []` everywhere → returns `[]` (R5.1 regression guard)
    - _Requirements: 4.1, 5.1, 7.3_

  - [x]* 8.2 Write smoke checks — one-path invariant and render parity
    - Assert extraction reuses `buildScannedTopicsFromModule` → `runWeeklyCanonicalize`
      → `persistWeeklyTopicRankings` with no second classification/news path (R4.5, R9.4)
    - Assert `ReportRenderer` has no manual-vs-auto branch — both render through the
      same `TopTopicsTable` path (R8.2)
    - _Requirements: 4.5, 8.2, 9.4_

  - [-]* 8.3 Verify `MarkdownContentEditor` renders extracted topics (UNCHANGED component)
    - Test that v4 content from Smart Paste routes to `MarkdownContentEditor` and
      `TopTopicsEditor` renders/edits/removes the extracted `topTopics` per module —
      identically whether sourced from a table or prose (R7.1, R7.2, R7.4)
    - File `src/components/admin/__tests__/markdown-content-editor.test.tsx`
    - _Requirements: 7.1, 7.2, 7.4_

- [x] 9. Final checkpoint — full suite green
  - Ensure all tests pass, ask the user if questions arise.
  - Reminder: migration `028_add_news_report_id.sql` must be run in the Supabase SQL
    Editor before the publish route's `report_id` insert / R9.1 delete work against
    the live schema. No Inngest resync, no env-var changes.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP;
  core implementation tasks (1.1, 2.1, 3.1, 5.1, 6.1, 6.2, 7.1) are never optional.
- Each task references granular requirement clauses for traceability.
- The seven property tests (2.2–2.8) all live in one file
  (`extract-top-topics.test.ts`), so they are scheduled in separate waves to avoid
  write conflicts even though they are logically independent.
- `MarkdownContentEditor.tsx` is intentionally **not** modified — it already renders
  `TopTopicsEditor` for v4 content; task 8.3 only verifies this.
- Out of scope (logged in design): renderer table de-dup, module-reorder UI,
  widening the publish scan range beyond `[0, 1]`, dictionary naming-prior into
  extraction, English-paste dictionary-quality validation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["3.1", "7.1", "2.2"] },
    { "id": 2, "tasks": ["5.1", "3.2", "2.3"] },
    { "id": 3, "tasks": ["5.2", "6.1", "6.2", "8.1", "2.4"] },
    { "id": 4, "tasks": ["8.2", "8.3", "2.5"] },
    { "id": 5, "tasks": ["2.6"] },
    { "id": 6, "tasks": ["2.7"] },
    { "id": 7, "tasks": ["2.8"] }
  ]
}
```
