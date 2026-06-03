# Design Document: Smart Paste Topic Extraction

## Overview

This feature makes a **manually pasted** regular radar report flow through the
same publish-time intelligence pipeline (canonical dictionary → weekly trending
→ AI Insight news) that auto-run reports already use, and makes the manual
report's **derived artifacts** (its `topic_rankings` rows and its AI Insight
news) owned by the report so re-publishing never duplicates them and deleting a
report never orphans them.

Today the manual report cannot reach the pipeline, for one structural reason:
Smart Paste (`POST /api/ai/format-report`) is markdown-first and assigns
**every** module `topTopics: []` by design (the route comment literally says
manual pastes "skip the topic-extraction pipeline"), while the entire
publish-time pipeline enters through `buildScannedTopicsFromModule`, which reads
**only** `module.topTopics[]`. Empty `topTopics` → `totalScanned = 0` →
`topic_rankings` stays empty → trend chart render gate never met → AI Insight
news has nothing to compute from.

The information the pipeline needs is already present in the pasted text — but
**not necessarily as a table.** The admin's source describes the top topics in
whatever shape the original doc used: a Markdown table, free-form prose, a
bullet list, numbered paragraphs, or a mix. A table is one shape among several,
not a guarantee. This design adds a second, **additive** extraction step to
Smart Paste: after the existing markdown-first assembly produces the readable
`ReportContent`, an LLM step reads each in-scope module body, identifies the top
topics in **any** shape, and emits structured `topTopics[]` — constrained at the
API level (`response_format`) and validated with Zod (drop/repair on invalid
rows). One paste then yields **both** the readable markdown **and** the
structured `topTopics` the publish pipeline already consumes.

The LLM here is the **synthesizer analogue**: an auto-run report does not parse
its `topTopics` out of a table either — the synthesizer identifies and
summarizes the top topics from the research engines' output. The manual path is
asked to do the analogous thing from the pasted body: identify and condense, not
only parse rows. Per Principle 2, structural correctness is owned by **code**
after the call (drop empty-`topic` rows, Zod validate/drop/repair), not by a
pre-call shape detector.

What this design deliberately does **not** do:

- It does **not** add a new downstream pipeline. Extracted topics flow through
  the unchanged `buildScannedTopicsFromModule` → `runWeeklyCanonicalize` →
  `persistWeeklyTopicRankings` path (one-dictionary invariant, R4.5).
- It does **not** change the `TopTopic` contract, `ReportModuleV4Schema`, the
  canonicalize/scan logic, or the `[0, 1]` scan range in `runCanonicalizeBlock`.
- It **does** change the publish route's **AI Insight news block** (and only
  that block) to set `report_id` and replace-not-append on re-publish (R9). The
  canonicalize/scan portion of publish is untouched.
- It does **not** consult the canonical dictionary during extraction. Extraction
  is faithful-to-paste; dictionary alignment stays at the shared canonicalize
  layer (see decision log).
- It does **not** translate topic text during extraction (Principle 3 — topic
  text stays in the pasted language; `content_translated` is produced later by
  the separate translate path).
- It does **not** rewrite the markdown body or strip a table from it. Extraction
  adds structured data; the prose is preserved verbatim (R1.6).

### Why an LLM step instead of a deterministic parser

The pasted top-topics content is human-authored docx export prose. Even when it
*is* a table, column headers vary (`排名` / rank, `核心原因` / reason,
`关键词` / keywords, `热度` / heat, `误区` / misconception), language is mixed,
severity is expressed as `高/中/低`, `high/medium/low`, or `高风险`, and cells
contain commas and free text. But the common case is **not** a table at all —
it is prose, bullets, or numbered paragraphs that carry no fixed columns, where
rank / heat / volume are implicit or absent. A deterministic `split('|')` parser
is brittle across table shapes and **blind** to prose entirely; gating
extraction on "a Markdown table is present" would re-create the exact
invisibility R2.4 forbids for the prose-form pastes that are the norm.

Per Principle 2, reliability does **not** come from prompt-hope and does not
come from a pre-call shape detector. It comes from the **architecture around**
the call: the LLM identifies and condenses the topics in any shape (the
synthesizer analogue, R6.4), an API-level `response_format` JSON constraint
binds the call's output shape, and a Zod validate/drop/repair pass plus an
empty-`topic` drop after the call own structural correctness and the
no-fabrication safety rail (R2.3 / R3.1 / R3.5). The LLM owns summarization
quality; code owns structural correctness — independent of whether the source
was a table or prose.

## Architecture

### Smart Paste — two-layer flow (interactive endpoint)

Smart Paste is the **exception** to "time doesn't matter" — the admin is waiting
on the response (Principle 1). The two layers are sequenced so the reliable
markdown backbone is never blocked by the best-effort extraction, and the
extraction calls run in parallel to bound added latency.

```
POST /api/ai/format-report
  │
  ├─ Layer 1  (UNCHANGED — markdown backbone, always runs)
  │    LLM #1: raw text → plain Markdown
  │    → stripOuterFences → buildReportContentFromMarkdown
  │    → ReportContent { title, dateRange, modules[].topTopics = [] }
  │
  └─ Layer 2  (NEW — additive topic extraction, best-effort, per in-scope module)
       for EVERY in-scope module (no table pre-gate):
         (run in parallel — Promise.allSettled)
         ┌──────────────────────────────────────────────┐
         │ LLM #2: module.markdown → topTopics JSON                    │
         │   "identify the top topics in ANY shape (table, prose,      │
         │    bullets, numbered paragraphs); return [] if there is     │
         │    genuinely no topic content; do not invent."              │
         │   response_format: json_schema  (API constraint, R6.2)      │
         │            │                                                │
         │            ▼                                                │
         │ normalizeExtractedTopics()  (pure, code-owned)              │
         │   • map heat→severity, volume→voice_volume                  │
         │   • apply documented defaults (R1.3 / R1.4)                 │
         │   • DROP rows with empty/whitespace `topic` (no fabrication) │
         │   • Zod TopTopicSchema per row → drop/repair invalid (R6.1) │
         │   • sort by rank, cap at 10 keeping highest (R1.5)          │
         │            │                                                │
         │            ▼                                                │
         │ module.topTopics = validated rows  (or [] on any failure)   │
         └──────────────────────────────────────────────┘
  │
  ▼
return { title, dateRange, modules[], extraction: { perModule[], total } }
```

Layer 1 is byte-for-byte the current implementation. **There is no
`hasMarkdownTable` gate.** Every in-scope module gets a constrained LLM call;
the LLM returns an empty `topics` array when there is genuinely no topic content
(prose or otherwise), and code drops any row whose `topic` is empty/whitespace.
This is what lets prose-form pastes — the common case — produce topics, while
the no-fabrication rail (R2.3 / R3.5) stays **code-owned** rather than depending
on a shape detector. If Layer 2 throws, times out, or returns garbage for a
module, that module keeps `topTopics: []` and the markdown body is untouched
(R5.2, R6.3). A failure in one module's extraction does not affect any other
module (per-module `Promise.allSettled`), and is reported as a *failed* outcome
distinct from a genuine *empty* (R5.4).

### Publish — canonicalize unchanged; AI Insight news block refactored for ownership

```
PUT /api/reports/[id]/publish
  ├─ runCanonicalizeBlock(id, report)              ← UNCHANGED
  │     moduleIndices = [0, 1]                       ← unchanged
  │     buildScannedTopicsFromModule(content, i)     ← now returns the extracted
  │                                                    topics instead of []
  │     → runWeeklyCanonicalize → applyDictionaryTrueUp
  │     → persistWeeklyTopicRankings  → topic_rankings rows
  │        (already DELETE-by-report_id-then-insert → idempotent;
  │         report delete already cascades topic_rankings via its report_id FK)
  │
  └─ AI Insight news block                          ← REFACTOR (R9)
        before generating: DELETE FROM news
          WHERE report_id = reportId AND source_channel = 'AI Insight'
        generate news from cross-week topic_rankings  (unchanged logic)
        INSERT each row WITH report_id = reportId      (NEW column)
```

The canonicalize half of publish is entirely reused — the only difference is
that `buildScannedTopicsFromModule` now finds a populated `topTopics[]` for
modules 0/1, so `totalScanned > 0` and the rest runs exactly as for an auto-run
report (R4.1–R4.5). The manual report stops being invisible, with zero new
pipeline surface.

The AI Insight news block is refactored only to give the news rows the same
report-ownership the rankings already have:

- **Idempotent re-publish (R9.1):** before generating, delete this report's
  existing `'AI Insight'` news rows, then insert the freshly generated ones —
  mirroring the `DELETE FROM topic_rankings WHERE report_id = p_report_id` then
  insert pattern inside `persist_weekly_topic_rankings`. Re-publish **replaces**,
  it does not append, so AI Insight news no longer accumulates across the
  edit-and-republish workflow Smart Paste makes primary (Requirement 7).
- **Ownership link (R9.3):** every inserted AI Insight row carries
  `report_id = reportId`, making both the replace (R9.1) and the cascade (R9.2)
  enforceable at the data layer instead of by application guesswork.

### Cascade delete — both derived artifacts die with the report (R9.2)

- `topic_rankings` **already** cascades: its `report_id` FK to `reports`
  is `ON DELETE CASCADE`, and `DELETE /api/reports/[id]` (`route.ts`,
  `supabase.from('reports').delete().eq('id', id)`) already removes the report's
  rankings.
- `news` **does not** today: the table (migration 001) references only
  `domain_id`. Migration **028** adds `news.report_id UUID NULL REFERENCES
  reports(id) ON DELETE CASCADE`, so deleting a report auto-removes its AI
  Insight news at the DB level. The FK enforces the cascade in the engine, so it
  fires even though the report DELETE runs through the user-scoped client (RLS
  does not gate FK cascades).

`report_id` is **NULL-able** because human-authored / non-report-derived news
(curated `/api/news` POST rows) has no originating report; only the publish
route's AI Insight rows set it.

### Extraction scope — resolution of the Requirement 2.2 open question

**Decision: attempt extraction for _every_ module body — not only the first N
within the Scanned_Module_Range `[0, 1]`. The publish-time scan range stays
`[0, 1]`, unchanged.**

Rationale:

- **Single uniform rule.** "Attempt extraction on every in-scope module; the LLM
  returns [] when there is no topic content" needs no positional special-casing
  and no assumption about the pasted section order. This is the simplest rule
  that is also the most faithful (R3) and the one that handles prose.
- **Robust to section-order variance** (the exact concern R2.2 raises). If the
  admin pastes a report where the suspension topics sit in module 2 (because
  their source ordered sections differently), that module still gets structured
  `topTopics` and renders the structured table — topics are **not silently
  dropped at the extraction stage**.
- **No parallel classification path, scan range untouched** (R4.5). The publish
  pipeline still consumes only indices `[0, 1]`, identical to auto-run behavior.
  Extracting for modules ≥ 2 costs one extra parallel LLM call and makes those
  modules render their structured table; it does not create a second dictionary
  path, and those topics simply do not reach trending today (they are
  pipeline-ready if the shared scan range is ever widened).

#### Order-mismatch backstop — observability, not a reorder UI

The previous design claimed the admin "fixes module order in the editor before
publishing." **That backstop is fictional:** `MarkdownContentEditor`
(`src/components/admin/MarkdownContentEditor.tsx`) exposes only `updateModule`,
`removeModule`, and per-topic `removeAt` — there is **no move / reorder / drag**
capability. The real backstop is **observability**:

- The endpoint returns a **per-module extraction count** (R5.3) plus a
  **failed-vs-empty distinction** (R5.4). An order mismatch is therefore visible
  to the admin as a count pattern — e.g. "module 0 extracted 0, module 2
  extracted 8" tells the admin the suspension topics landed outside the
  `[0, 1]` scan range.
- The admin corrects this by **editing the markdown directly** — cut the topic
  content out of module 2's body and paste it into module 0's body using the
  existing per-module Markdown editor — then re-running Smart Paste or editing
  the structured `topTopics` rows. No reordering UI is required, because none
  exists and this feature does not build one.

**Out of scope (future enhancement only):** a module reorder / drag-to-reorder
control in `MarkdownContentEditor`. It is logged here so a future reader knows
the omission is deliberate, not an oversight — order correction today is
markdown editing, not module reordering.

A module **inside** `[0, 1]` that genuinely has no topic content in any shape is
left with `topTopics: []` and never fabricates topics (R2.3).

### Rendering consequence of R1.6 (preserve the markdown body)

R1.6 mandates keeping the module's markdown body unchanged. `MarkdownModuleCard`
(`src/components/report/ReportRenderer.tsx`) renders **both** `TopTopicsTable`
(driven by `topTopics`) **and** the markdown body. Two cases (R8.4 / R8.5):

- **Source was a table:** the same topics appear twice — once as the structured
  `TopTopicsTable`, once inside the prose table in the body.
- **Source was prose:** the structured `TopTopicsTable` is purely additive; the
  body has no duplicate table.

**Decision: accept the duplicate render for the table case; keep the markdown
verbatim.** Stripping a table out of the markdown body is exactly the fragile
text surgery R6.3 warns against and would violate R1.6's "unchanged"
requirement. De-duplicating the rendered view (e.g. teaching `MarkdownRenderer`
to suppress a leading table when `topTopics` is present) is a **renderer-only**
follow-up that also affects auto-run reports; it is logged as out-of-scope here.

## Components and Interfaces

Each item carries a status (NEW / REFACTOR / UNCHANGED) and the requirements it
serves.

### `src/lib/smart-paste/extract-top-topics.ts` — NEW

The code-owned correctness layer. Pure, synchronous functions plus one async
LLM-call wrapper. This is where the property-based tests live. **No table
detector** — there is no `hasMarkdownTable`; faithfulness is owned by the
empty-`topic` drop and the Zod pass, independent of source shape.

```typescript
import { z } from 'zod';
import type { TopTopic } from '@/types/report';
import { TopTopicSchema } from '@/lib/validators/report-schema';

/** Loose shape the LLM is asked to emit per identified topic — every field
 *  optional so a missing value never fails JSON parsing; defaults are applied
 *  in code. Works identically for table rows and prose-summarized topics. */
export interface RawTopicCandidate {
  rank?: string | number;
  topic?: string;
  voice_volume?: number | string;
  keywords?: string[] | string;
  seller_discussion?: string;
  severity?: string;        // free text: 高/中/低, high/medium/low, 高风险, ...
}

/** Documented default severity when the source gives no determinable level (R1.4). */
export const DEFAULT_SEVERITY: TopTopic['severity'] = 'medium';
export const MAX_TOPICS_PER_MODULE = 10;          // mirrors ReportModuleV4Schema
export const MAX_KEYWORDS = 10;                   // mirrors TopTopicSchema

/**
 * Map one free-text severity value to high/medium/low. Recognizes Chinese
 * (高/中/低, 高风险/中风险/低风险) and English (high/medium/low) forms.
 * Returns DEFAULT_SEVERITY when undeterminable (R1.4) — never omits.
 */
export function coerceSeverity(raw: unknown): TopTopic['severity'];

/**
 * Map a heat/volume value to a non-negative number. Non-numeric / missing /
 * negative → 0 (R1.3). Prose that states no volume → 0.
 */
export function coerceVoiceVolume(raw: unknown): number;

/**
 * The correctness core. Takes the raw candidate topics the LLM emitted (from a
 * table or summarized from prose) and produces a clean, schema-valid
 * TopTopic[]:
 *   1. Coerce each field, applying documented defaults (R1.2 / R1.3 / R1.4).
 *   2. Drop rows whose `topic` is empty/whitespace (no fabricated topic — the
 *      code-owned no-fabrication rail, R2.3 / R3.1 / R3.5).
 *   3. Validate each row against TopTopicSchema; drop rows that still fail (R6.1).
 *   4. Cap keywords at MAX_KEYWORDS, dedupe/trim.
 *   5. Sort by parsed rank ascending; cap at MAX_TOPICS_PER_MODULE keeping the
 *      highest-ranked rows (R1.5). Rank is the source order — never re-ranked.
 * Pure — no I/O, deterministic, idempotent.
 */
export function normalizeExtractedTopics(
  candidates: RawTopicCandidate[]
): TopTopic[];

/**
 * Async wrapper: one constrained LLM call for one module body, then
 * normalizeExtractedTopics on the result. Never throws — returns
 * { topics: [], dropped, failed } on any failure mode (non-2xx, timeout, empty,
 * unparseable JSON, all-rows-dropped) so a module's extraction failure cannot
 * block the paste (R5.2, R6.3). `failed` distinguishes an extraction failure
 * from a genuine empty result (R5.4).
 */
export async function extractTopTopicsForModule(args: {
  markdown: string;
  apiKey: string;
  signal?: AbortSignal;          // interactive timeout budget
}): Promise<{ topics: TopTopic[]; dropped: number; failed: boolean }>;
```

LLM-call details (R6.2 / R6.3 / R6.4 / Principle 2):

- `response_format: { type: 'json_schema', json_schema: { ... } }` describing
  `{ topics: RawTopicCandidate[] }`. If the chosen OpenRouter route rejects
  `json_schema`, fall back to `json_object` (still an API constraint, never
  prompt-only) — matching the existing AI Insight news call which uses
  `json_object`.
- System prompt is the **synthesizer analogue**, narrow and faithfulness-focused:
  "identify the top topics described in this section, in whatever shape they
  appear (a table, prose, a bullet list, or numbered paragraphs); for each, give
  a topic name, the keywords, and a one-line seller-discussion summary; you MAY
  condense prose but MUST NOT invent topics, keywords, or numbers; keep the
  original language; preserve the source order as `rank`; if there is genuinely
  no topic content, return an empty list." The LLM owns identify + condense
  (R6.4); **code** owns structural correctness (`normalizeExtractedTopics` +
  the empty-`topic` drop + Zod), not the prompt and not a shape detector.
- A bounded timeout (`AbortSignal`, ~30–45s) since the admin is waiting. On
  abort → `{ topics: [], dropped: 0, failed: true }`.

### `src/app/api/ai/format-report/route.ts` — REFACTOR

Keeps Layer 1 (markdown assembly) exactly as-is. Adds Layer 2 after
`buildReportContentFromMarkdown` — **no table pre-gate**:

```typescript
// after `parsed` (ReportContent with topTopics: []) is built …
const apiKey = OPENROUTER_API_KEY!;
const results = await Promise.allSettled(
  parsed.modules.map(async (m, idx) => {
    const { topics, dropped, failed } = await extractTopTopicsForModule({
      markdown: m.markdown, apiKey, signal: AbortSignal.timeout(45_000),
    });
    return { idx, topics, dropped, failed };
  })
);

const perModule = parsed.modules.map((m, idx) => {
  const r = results[idx];
  const ok = r.status === 'fulfilled'
    ? r.value
    : { topics: [], dropped: 0, failed: true };   // settled-rejected → failed
  m.topTopics = ok.topics;               // additive; markdown untouched (R1.6)
  return {
    moduleIndex: idx,
    title: m.title,
    extracted: ok.topics.length,
    dropped: ok.dropped,
    outcome: ok.failed ? 'failed' : (ok.topics.length === 0 ? 'empty' : 'ok'),
  };
});

return NextResponse.json({
  ...parsed,                              // title, dateRange, modules
  extraction: { perModule, total: perModule.reduce((n, p) => n + p.extracted, 0) },
});
```

The `ReportModuleLite.topTopics` type changes from `never[]` to `TopTopic[]`.
The response gains a sibling `extraction` summary with a per-module `outcome`
(`ok` / `empty` / `failed`, R5.3 / R5.4) — it is **not** part of `ReportContent`
and must not be saved into `reports.content`.

The route's stale comment ("manual pastes skip the topic-extraction pipeline …
nothing structured to mine out of the prose") is corrected — the whole point is
that there *is* structure to mine, in prose as well as tables.

### `src/app/(main)/admin/reports/new/page.tsx` — REFACTOR

`handleAiFormat` currently does `setContent(data as ReportContent)`, which would
now also fold the `extraction` field into content. Strip it and read the summary:

```typescript
const { extraction, ...content } = data;
setContent(content as ReportContent);
if (extraction) setExtractionNotice(extraction);   // non-blocking banner (R5.3/R5.4)
```

Render a small non-blocking notice: `Extracted N topics across M modules`, with
per-module `outcome` shown so a `failed` module reads differently from an
`empty` one (R5.4) — e.g. `module 2: extraction failed` vs `module 3: no topics
found`. Uses the existing `bg-primary-soft` / `text-foreground-muted` tokens —
no new color.

### `src/components/admin/ContentEditor.tsx` (SmartPasteSection) — REFACTOR

Same `extraction`-stripping fix in `handleFormat` so the embedded Smart Paste box
behaves identically. Surfaces the same count + outcome notice.

### `src/components/admin/MarkdownContentEditor.tsx` — UNCHANGED

Already routes v4 content (modules with `markdown`) and already renders
`TopTopicsEditor` per module (Rank / Topic / 热度 / Keywords / 卖家讨论 / 严重 /
remove). Because Smart Paste returns v4 content, `isV4Content(content)` is true,
`ContentEditor` routes here, and the extracted `topTopics` are **already
visible, editable, and removable** before publish (R7.1, R7.2, R7.4). Edits
mutate `content.modules[].topTopics`, which `buildScannedTopicsFromModule` reads
at publish, so corrections carry into the pipeline (R7.3).

**Note:** this component has **no module-reorder capability** (only
`updateModule` / `removeModule` / per-topic remove). Order correction for the
R2.2 backstop is done by editing the markdown bodies, not by reordering modules
(see Architecture → Order-mismatch backstop). No change needed here.

### `src/app/api/reports/[id]/publish/route.ts` — REFACTOR (AI Insight news block only)

The `runCanonicalizeBlock` call and its entire body are **UNCHANGED** (scan
range stays `[0, 1]`, one-dictionary invariant intact). Only the AI Insight news
block changes (R9.1 / R9.3):

```typescript
// inside the AI Insight news try-block, BEFORE generating news:
// Idempotent replace — mirror persist_weekly_topic_rankings' DELETE-by-report_id.
await supabase
  .from('news')
  .delete()
  .eq('report_id', id)
  .eq('source_channel', 'AI Insight');

// … unchanged: fetch topic_rankings, build prompt, call OpenRouter …

// each insert now carries the ownership link:
const { data: insertedNews, error: insertErr } = await supabase
  .from('news')
  .insert({
    domain_id: report.domain_id,
    created_by: user.id,
    report_id: id,                         // NEW (R9.3) — was absent
    title: item.title,
    summary: item.summary || null,
    content: item.content,
    source_channel: 'AI Insight',
    is_pinned: false,
  })
  .select('id')
  .single();
```

The delete-before-generate runs inside the existing `try/catch` that already
guards the news block, so an AI Insight failure still never blocks the publish
200 (existing posture preserved). The translate-enqueue per inserted row is
unchanged.

### `supabase/migrations/028_add_news_report_id.sql` — NEW

Append-only migration (next sequential number after 027). Adds the ownership
column + supporting index, following the 026/027 verification/rollback
comment-block convention. See Data Models for the column contract.

### Publish canonicalize path / `scan.ts` / schema / types — UNCHANGED

`buildScannedTopicsFromModule`, `runCanonicalizeBlock` (`moduleIndices = [0,1]`),
`runWeeklyCanonicalize`, `persistWeeklyTopicRankings`, `TopTopicSchema`,
`ReportModuleV4Schema`, and `TopTopic` are all reused as-is (R4.5).

## Data Models

### TopTopic (reused, not redefined)

Extraction targets the **existing** contract — no schema change. The extraction
source is a `Top_Topics_Source` in any shape (table or prose), not specifically
a table.

| Field | Type / rule | Extraction source & default |
|---|---|---|
| `rank` | `string`, non-empty | explicit source numbering (table rank cell, or 1/2/3 prose ordinals); else 1-based order of appearance — never re-ranked (R1.5) |
| `topic` | `string`, non-empty | identified topic name; **empty/whitespace → row dropped** (no fabrication, R3.1/R3.5) |
| `voice_volume` | `number` ≥ 0 | heat/volume signal via `coerceVoiceVolume`; none present (incl. prose) → `0` (R1.3) |
| `keywords` | `string[]`, ≤ 10 | keywords from source, split on `、,，`; trimmed, deduped, capped (R1.2) |
| `seller_discussion` | `string` | reason / misconception / discussion, condensed from prose where needed; missing → `''` |
| `severity` | `'high'\|'medium'\|'low'` | heat-level signal via `coerceSeverity`; undeterminable (incl. prose) → `'medium'` (R1.4) |
| `cross_engine_confirmed?` | `boolean?` | omitted — manual paste has no cross-engine signal |

`ReportModuleV4Schema` caps `topTopics` at 10; `normalizeExtractedTopics`
enforces the same cap, keeping the highest-ranked rows (R1.5).

### API response shape (Smart Paste)

```typescript
type ModuleOutcome = 'ok' | 'empty' | 'failed';   // R5.4 distinction

interface ExtractionSummary {
  perModule: Array<{
    moduleIndex: number;
    title: string;
    extracted: number;   // topics kept after validation
    dropped: number;     // candidate rows dropped (invalid / empty topic)
    outcome: ModuleOutcome;  // 'failed' = extraction error; 'empty' = genuinely no topics
  }>;
  total: number;
}

// POST /api/ai/format-report response
type FormatReportResponse = ReportContent & { extraction: ExtractionSummary };
```

`ReportContent` is unchanged. `extraction` is transient UI metadata, stripped
before save.

### `news.report_id` — NEW (migration 028, R9)

```sql
ALTER TABLE news
  ADD COLUMN report_id UUID NULL REFERENCES reports(id) ON DELETE CASCADE;

CREATE INDEX idx_news_report_id ON news(report_id);
```

| Property | Value | Why |
|---|---|---|
| Nullability | `NULL` | Human-authored / curated news (`/api/news` POST) has no originating report; only publish-route AI Insight rows set it. |
| FK target | `reports(id)` | The report that produced the news owns it (R9.3). |
| On delete | `CASCADE` | Deleting a report auto-removes its AI Insight news (R9.2). Enforced in the DB engine, so it fires through the user-scoped client in `DELETE /api/reports/[id]` (RLS does not gate FK cascades). |
| Index | `news(report_id)` | Supports the R9.1 delete-by-`report_id` replace lookup and the cascade. |

**Cascade-delete symmetry after 028:**

| Derived artifact | Ownership link | Idempotent replace on re-publish | Cascade on report delete |
|---|---|---|---|
| `topic_rankings` | `report_id` FK (pre-existing, `ON DELETE CASCADE`) | `persist_weekly_topic_rankings`: `DELETE … WHERE report_id` then insert (pre-existing) | already cascades |
| AI Insight `news` | `report_id` FK (NEW, migration 028) | publish route: `DELETE … WHERE report_id AND source_channel='AI Insight'` then insert (NEW) | cascades via new FK |

### Scanned-topics projection (reused)

At publish, `buildScannedTopicsFromModule` projects each extracted `TopTopic`
into the 3-field `ScanTopic` shape the shared canonicalize prompt consumes —
identical to auto-run:

```
topic_name_zh ← topic     summary_zh ← seller_discussion     keywords ← keywords
```

No new persistence in the canonicalize path. `topic_rankings` / `topic_canonicals`
are written by the unchanged `persistWeeklyTopicRankings` RPC.

## Decision Log

One-line *why* for each non-obvious decision, per the team's decision-log
discipline.

- **No `hasMarkdownTable` gate; attempt extraction on every in-scope module.**
  The common paste shape is prose, not a table; gating on a table would
  re-create the R2.4 invisibility for prose. The LLM identifies topics in any
  shape (synthesizer analogue), and the no-fabrication rail is code-owned (drop
  empty-`topic` rows + Zod), so a pre-call shape detector is both unnecessary and
  harmful. (CHANGE 1)

- **Order-mismatch backstop is observability, not a reorder UI.**
  `MarkdownContentEditor` has no move/reorder capability — only update / remove
  module and remove topic. So the per-module count (R5.3) + failed-vs-empty
  distinction (R5.4) make an order mismatch *observable*, and the admin corrects
  it by editing markdown bodies directly. Building a reorder UI is deferred — it
  is a real future enhancement, not part of this MVP. (CHANGE 2)

- **Dictionary stays in canonicalize; extraction does NOT consult it.** Verified:
  `runWeeklyCanonicalize` already feeds the full dictionary to the LLM via
  `existing_canonicals_json` (the `existingCanonicals` arg) at the shared
  canonicalize layer used by all pipelines. Extraction deliberately does not see
  the dictionary because (a) extraction's job is faithful-to-paste (R3), and
  letting it align to dictionary entries risks dictionary-induced fabrication;
  (b) auto-run reports don't align to the dictionary at synthesizer time either —
  they align at canonicalize; mirroring that keeps clean layering (extraction =
  synthesizer analogue, canonicalize = shared dictionary gate); (c) prose topics
  therefore pass through the **same** canonicalize gate (driven by
  `existing_canonicals_json`) that auto-run uses, so they need no separate quality
  gate. **Deferred future enhancement:** feeding dictionary canonical titles as a
  soft *naming prior* into extraction — a consistency optimization, not a
  correctness dependency, and it carries R3 fabrication risk. Revisit only if
  prose extraction is observed degrading the dictionary. (CHANGE 3)

- **Derived artifacts hard-cascade with the report (option A).** A report owns
  its `topic_rankings` and AI Insight news; re-publish replaces them and delete
  removes them. Accepted tradeoff (R9.5): a hard cascade MAY silently remove an
  AI Insight news item a reader had already seen. Accepted because the report is
  the source of truth for its derived artifacts; the alternative (orphaned news +
  duplicate accumulation on the now-primary edit-and-republish workflow) is
  worse. (CHANGE 4)

- **`news.report_id` is NULL-able.** Human-authored / curated news has no
  originating report. Only the publish route's AI Insight rows set it; a NOT NULL
  column would break `/api/news` POST. (CHANGE 4)

### Known limitations (recorded so no one "fixes" them later)

- **`voice_volume` does NOT feed trending.** The dashboard trend chart orders
  topics by `rank` from `topic_rankings` (`DashboardClient.tsx` maps
  `weekMap[week][canonical_key] = r.rank`; Y-axis is "Rank"), and
  `buildScannedTopicsFromModule` omits `voice_volume` from the scanned payload
  entirely. So the prose `voice_volume = 0` default (R1.3) is harmless to
  trending — it only affects the renderer's display. Do not "fix" the default
  thinking it skews trending; it cannot. (CHANGE 5)

- **`rank` = source order; the LLM never re-ranks (R1.5).** Source order is the
  author's ranking. Extraction preserves it (explicit numbering when present,
  else order of appearance) and `normalizeExtractedTopics` only sorts by that
  rank — it does not substitute its own importance judgment. Getting source-order
  rank right matters because rank drives the trend chart. (CHANGE 5)

- **English-paste dictionary quality is UNVERIFIED.** Canonicalize consumes
  `topic` / `seller_discussion` as `topic_name_zh` / `summary_zh`, and the
  canonicalize prompt is a Chinese "话题归类员". Manual paste is the first likely
  entry point for **English** topics into canonicalize. The
  dictionary-classification quality for English pastes is not yet validated.
  Recorded as a known limitation, not solved in this feature. (CHANGE 5)

- **`format-report` shape non-regression.** Changing `ReportModuleLite.topTopics`
  from `never[]` to `TopTopic[]` must not regress the existing Smart Paste
  behavior for no-topic-content pastes — a paste with no topics must still return
  valid `ReportContent` with `topTopics: []` for every module. Covered by an
  explicit regression test (see Testing Strategy). (CHANGE 5)

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all
valid executions of a system — essentially, a formal statement about what the
system should do. Properties serve as the bridge between human-readable
specifications and machine-verifiable correctness guarantees.*

These properties apply here because the **correctness layer is a pure function**
(`normalizeExtractedTopics` and its `coerceSeverity` / `coerceVoiceVolume`
helpers). Per Principle 2, this is exactly where reliability is enforced — not in
the LLM prompt and **not** in a pre-call shape detector. The faithfulness
guarantee (no fabrication) is **code-owned and independent of source shape**:
whether the LLM read a table or summarized prose, the same pure functions drop
empty-`topic` rows and Zod-validate the rest. The LLM call itself
(`extractTopTopicsForModule`), the publish-time pipeline reuse, and the R9
derived-artifact ownership are **not** property-tested (external service + DB +
UI; see Testing Strategy → integration, example, and smoke tests). The
properties below quantify over arbitrary candidate rows — including malformed,
partial, prose-summarized, and adversarial inputs — because that is exactly what
an LLM identifying topics in a messy human document can emit.

### Property 1: Every extracted topic is a schema-valid TopTopic

*For any* array of raw candidate topics (including malformed, partial,
prose-summarized, or adversarial rows), every element of
`normalizeExtractedTopics(candidates)` passes `TopTopicSchema.safeParse` — i.e.
`rank` is a non-empty string, `topic` is a non-empty string, `voice_volume` is a
number ≥ 0, `keywords` is a string array of length ≤ 10, `seller_discussion` is
a string, and `severity` is one of `high|medium|low`. No invalid row is ever
returned (invalid rows are dropped or repaired).

**Validates: Requirements 1.2, 6.1, 6.4**

### Property 2: Output is capped at 10, keeping the highest-ranked rows, and rank is source order

*For any* array of candidate rows, `normalizeExtractedTopics` returns at most
`MAX_TOPICS_PER_MODULE` (10) topics; when the input has more than 10 valid rows,
the kept set is the highest-ranked — no lower-ranked valid row is retained while
a higher-ranked valid row is dropped. *For any* candidate row, the assigned
`rank` reflects the source order — explicit source numbering when present, else
the 1-based order of appearance — and the function never substitutes its own
importance judgment for the source order (no re-ranking).

**Validates: Requirements 1.5**

### Property 3: Documented defaults are always applied, never omitted

*For any* candidate row with a missing or undeterminable severity signal, the
resulting `severity` equals `DEFAULT_SEVERITY` (`'medium'`); and *for any*
candidate row with a missing, non-numeric, or negative volume signal, the
resulting `voice_volume` equals `0`. Equivalently: `coerceSeverity(x)` is always
in `{high, medium, low}` for any input `x`, and `coerceVoiceVolume(x)` is always
a number ≥ 0 for any input `x` — neither field is ever left undefined or
omitted. This holds identically for prose sources, which often carry no volume or
heat signal.

**Validates: Requirements 1.3, 1.4, 3.2, 3.4**

### Property 4: No fabrication — empty candidate set normalizes to [], empty-topic rows are dropped (code-owned, source-shape-independent)

*For any* empty candidate array, `normalizeExtractedTopics([])` returns `[]`; and
*for any* candidate array in which every row has an empty or whitespace-only
`topic`, `normalizeExtractedTopics` returns `[]`. More generally, every candidate
row whose `topic` is empty or whitespace is dropped. A module with genuinely no
topic content — whether because it was prose with nothing to summarize or a body
with no topics at all — is therefore never assigned fabricated topics. This
faithfulness guarantee is owned by code after the LLM call and does **not**
depend on detecting a table (there is no table detector): it holds equally for
table-shaped and prose-shaped sources.

**Validates: Requirements 2.3, 3.5, 5.1**

### Property 5: Faithful passthrough — extraction introduces nothing and preserves language

*For any* array of candidate rows, every `topic` string in the output equals
(after trimming) the `topic` of some input candidate, every output `keyword`
appears in some input candidate's keywords, and the output length is ≤ the input
length. No topic, keyword, or number absent from the input candidates is ever
introduced, and topic text is returned byte-for-byte (so original language is
preserved — Chinese stays Chinese, English stays English). Because the code never
introduces content the LLM did not emit, condensation quality is the LLM's
responsibility while structural faithfulness is the code's.

**Validates: Requirements 3.1, 3.3, 3.6**

### Property 6: Extraction is additive — the markdown body is never mutated

*For any* module and *for any* extracted topics array, merging the extracted
topics into the module sets only `module.topTopics` and leaves `module.markdown`
identical to its pre-merge value (`after.markdown === before.markdown`).

**Validates: Requirements 1.6, 6.3**

### Property 7: Valid rows in produce non-empty topics out

*For any* candidate array containing at least one row with a non-empty `topic`,
`normalizeExtractedTopics` returns a non-empty array — i.e. a module whose source
(table or prose) yields at least one real topic stops carrying an empty
`topTopics[]`.

**Validates: Requirements 1.1**

## Error Handling

The design's error philosophy mirrors the publish route's existing posture:
**the reliable backbone never fails because the best-effort enrichment failed.**
For Smart Paste, the backbone is the Layer-1 markdown body; the enrichment is
Layer-2 topic extraction. For publish, the backbone is the report-status update;
the enrichment is canonicalize + AI Insight news.

### Smart Paste extraction

| Failure point | Handling | Requirement |
|---|---|---|
| Layer-1 markdown LLM non-2xx / empty | Unchanged — return 502/422 as today. Extraction never runs. | (existing) |
| Module genuinely has no topic content | LLM returns empty `topics`; `normalizeExtractedTopics` → `[]`; `outcome: 'empty'`. Not an error. | R2.3, R5.1 |
| Layer-2 LLM non-2xx for a module | `extractTopTopicsForModule` catches, returns `{ topics: [], dropped: 0, failed: true }`; `outcome: 'failed'`. Module keeps `[]`; paste succeeds. | R5.2, R5.4, R6.3 |
| Layer-2 LLM timeout (AbortSignal) | Caught → `{ topics: [], failed: true }` for that module. Other modules unaffected (`Promise.allSettled`). | R5.2, R5.4, R6.3 |
| Layer-2 returns unparseable / non-JSON | Caught at `JSON.parse` → `{ topics: [], failed: true }`. | R5.2, R5.4, R6.1 |
| Some candidate rows invalid | `normalizeExtractedTopics` drops them; valid rows kept; `dropped` counted and surfaced; `outcome: 'ok'`. | R6.1, R5.3 |
| All candidate rows invalid / empty topics | Normalizes to `[]`; `outcome: 'empty'`; paste still valid. | R5.1, R3.5 |
| One module's extraction throws | Isolated by `Promise.allSettled` (settled-rejected → `outcome: 'failed'`); only that module → `[]`. Markdown bodies untouched. | R5.4, R6.3 |

Key guarantees:

- `extractTopTopicsForModule` **never rejects** — every path resolves to a
  (possibly empty) topics array plus a `failed` flag. The route wraps
  `Promise.allSettled` defensively so a programming error cannot 500 the paste.
- Extraction failure is **observable, not silent** (unlike the publish-time
  canonicalize block, because here the admin is present): the `extraction`
  summary reports `extracted` / `dropped` / `outcome` per module, and the editor
  banner distinguishes a `failed` module from an `empty` one (R5.4) before
  publish. A zero-extraction is visible at paste time, not discovered as an empty
  trend chart days later.
- The markdown body is never mutated by extraction (Property 6), so the
  JSON-string fragility that markdown-first removed cannot reappear (R6.3).

### Publish — derived-artifact ownership and idempotency (R9)

| Failure point | Handling | Requirement |
|---|---|---|
| Re-publish of a report | AI Insight news block first `DELETE FROM news WHERE report_id = id AND source_channel = 'AI Insight'`, then inserts freshly generated rows — replace, not append. Count never accumulates. | R9.1 |
| AI Insight delete-or-generate fails | Stays inside the existing news `try/catch`; logged non-blocking; publish still returns 200 (existing posture). | R9.1, existing |
| Report deleted | `news.report_id` FK `ON DELETE CASCADE` (migration 028) auto-removes its AI Insight news; `topic_rankings` already cascades via its own `report_id` FK. Both fire in the DB engine through `DELETE /api/reports/[id]`. | R9.2 |
| AI Insight insert without `report_id` | Cannot happen post-028 for the publish path — every AI Insight insert sets `report_id`. Pre-028 / curated `/api/news` rows leave it NULL and are unaffected by the cascade. | R9.3 |

Accepted tradeoff (R9.5): the hard cascade MAY remove an AI Insight news item a
reader had already seen. Accepted — the report is the source of truth for its
derived artifacts. Recorded in the Decision Log.

## Testing Strategy

Dual approach: **property tests** for the pure correctness core, **example /
mock tests** for the LLM-call wrapper and UI metadata, **integration tests** for
the publish-pipeline reuse and the R9 derived-artifact ownership, and **smoke /
visual checks** for rendering parity.

### Property-based tests (library: `fast-check`, already a devDependency)

Located in `src/lib/smart-paste/__tests__/extract-top-topics.test.ts`. Minimum
**100 iterations** per property (set `numRuns: 100` explicitly). Each test is
tagged with a comment referencing its design property:

```
// Feature: smart-paste-topic-extraction, Property 1: Every extracted topic is a schema-valid TopTopic
```

| Property | Generator strategy |
|---|---|
| P1 schema validity | `fc.array(rawCandidateArbitrary)` where each field is randomly present/absent/wrong-typed; assert every output row passes `TopTopicSchema`. |
| P2 cap ≤ 10 + source-order rank | `fc.array(validCandidate, { minLength: 0, maxLength: 30 })` with random ranks (some explicit, some absent); assert `out.length <= 10`, kept ranks are the 10 smallest, and rank follows explicit numbering when present else order of appearance (never re-ranked). |
| P3 defaults | `fc.anything()` into `coerceSeverity` (assert ∈ enum) and `coerceVoiceVolume` (assert number ≥ 0); plus candidates with missing severity/volume → assert defaults. |
| P4 no-fabrication | `normalizeExtractedTopics([])` → `[]`; `fc.array(candidateWithEmptyOrWhitespaceTopic)` → `[]`; assert every empty-`topic` row is dropped (no table detector involved). |
| P5 faithful passthrough | `fc.array(candidate)`; assert every output `topic` ∈ input topics (trimmed), output keywords ⊆ input keywords, output length ≤ input length, topic text byte-identical. |
| P6 additive merge | `fc.record({ markdown: fc.string(), topTopics: fc.array(topTopicArbitrary) })`; assert merge leaves `markdown` identical. |
| P7 non-empty when valid | `fc.array(candidate)` constrained to include ≥1 non-empty-`topic` row; assert output non-empty. |

One property = one `fc.assert(fc.property(...))` test.

### Example / mock tests

`extractTopTopicsForModule` (the LLM wrapper) is tested by **mocking `fetch`**:

- non-2xx response → resolves `{ topics: [], dropped: 0, failed: true }`, no throw (R5.2, R5.4)
- malformed JSON body → resolves `{ topics: [], failed: true }`, no throw (R5.2, R6.1)
- timeout / aborted signal → resolves `{ topics: [], failed: true }`, no throw (R5.2)
- valid response with one invalid + two valid rows → resolves 2 topics, `dropped: 1`, `failed: false` (R6.1, R5.3)
- valid response with empty topics, no error → `outcome: 'empty'`, `failed: false` (R5.4)
- prose-derived candidates (no table in the mocked body) → topics produced — confirms there is **no table pre-gate** (R2.4)
- request body assertion: includes `response_format` (R6.2)
- route-level `extraction.total === sum(perModule.extracted)` consistency (R5.3)

### Integration tests

- A fixture `ReportContent` with extracted `topTopics` in module 0 →
  `buildScannedTopicsFromModule(content, 0)` returns the projected `ScanTopic[]`
  (R4.1, R7.3). Confirms the manual report is no longer invisible to the pipeline.
- A fixture with **edited** `topTopics` → `buildScannedTopicsFromModule` returns
  the edited values (R7.3 — corrections carry into canonicalize).
- A `ReportContent` with `topTopics: []` everywhere → `buildScannedTopicsFromModule`
  returns `[]` (R5.1 regression guard; current behavior preserved).
- **R9.1 idempotent re-publish (DB):** publish a manual report twice → the count
  of `news` rows with `report_id = id AND source_channel = 'AI Insight'` does
  **not** accumulate across the two publishes (replace, not append).
- **R9.2 cascade delete (DB):** delete a published report → `0` `topic_rankings`
  rows and `0` AI Insight `news` rows remain for that `report_id`. Verifies both
  derived artifacts die with the report.
- **R9.3 ownership link (DB):** after publish, every generated AI Insight `news`
  row has `report_id = id`.

### Regression test (R5.1 / CHANGE 5 — format-report shape non-regression)

Explicit regression item: changing `ReportModuleLite.topTopics` from `never[]` to
`TopTopic[]` must not change behavior for a no-topic-content paste. A paste whose
modules contain no topic content (mock LLM returns empty topics) must still return
valid `ReportContent` with `topTopics: []` for every module — identical to the
pre-feature contract. Assert the response parses as valid `ReportContent` and every
module's `topTopics` is `[]`.

### Smoke / structural checks

- **R4.5 / R9.4 one-path invariant:** assert no second classification or
  news-generation path was introduced — extraction reuses
  `buildScannedTopicsFromModule` → `runWeeklyCanonicalize` →
  `persistWeeklyTopicRankings`, and only the publish route's AI Insight news block
  changed (the `runCanonicalizeBlock` body is untouched).
- **R8.2 rendering parity:** assert there is no manual-vs-auto branch in
  `ReportRenderer` — both render through the same `TopTopicsTable` path.

### Manual / visual verification (not automated)

- Paste a real **Chinese prose** regular report (no table) with top topics
  described in paragraphs → editor shows the summarized rows in `TopTopicsEditor`,
  edit one, publish → confirm a `topic_rankings` row appears for the domain/week
  (publish log `inserted=N`), trend chart renders once ≥ 2 weeks exist (R1.1, R4.2,
  R4.3, R7.1, R7.2, R8.5).
- Paste a **table-form** report → confirm the published `/reports/[id]` view shows
  the structured `TopTopicsTable` plus the in-body table (accepted duplicate per
  R8.4 / Architecture); flag if it reads poorly enough to justify the out-of-scope
  renderer de-dup follow-up.
- **R9 visual:** re-publish the same report and confirm AI Insight news count is
  stable (not doubled); delete the report and confirm its AI Insight news and trend
  rows disappear.

### Out of scope (logged)

- De-duplicating the structured `TopTopicsTable` vs an in-body markdown table in
  `MarkdownModuleCard` — renderer-only change, affects auto-run reports too.
- A **module reorder / drag-to-reorder UI** in `MarkdownContentEditor` — does not
  exist today; order correction is markdown editing. Deferred future enhancement,
  not built here (CHANGE 2).
- Widening the publish scan range beyond `[0, 1]` — extraction makes modules ≥ 2
  pipeline-ready, but the range change belongs to the shared pipeline spec.
- Feeding dictionary canonical titles as a soft naming prior into extraction —
  deferred consistency optimization with R3 fabrication risk (CHANGE 3).
- Validating English-paste dictionary-classification quality — known limitation,
  not solved here (CHANGE 5).

### Activation steps (manual, required for full enablement)

- **Supabase migration:** `supabase/migrations/028_add_news_report_id.sql` must be
  run in the SQL Editor (adds `news.report_id` + index + cascade FK). Until it is
  applied, the publish route's `report_id` insert and the R9.1 delete-by-`report_id`
  will fail against the old schema. This is the one mandatory manual step.
- No Inngest resync, no env-var changes, no Vercel config changes.
