# Requirements Document

## Introduction

When an admin runs a regular radar report **manually** (the deep-search engine
architecture changed enough that the manual copy-paste path is the current
fallback), they paste the full report text into **Smart Paste** (the "AI Format"
box on the new-report page). The AI structures it into a readable report. But the
manually-pasted report then **fails to flow into the downstream intelligence
pipeline**: it does not classify into the canonical topic dictionary, does not
produce weekly trending, and does not generate AI Insight news — even though the
pasted report body already describes the same top topics an auto-run report
produces. That description may arrive as a Markdown table, but it may equally
arrive as free-form prose, a bullet list, numbered paragraphs, or a mix.

### Root cause (grounded in current code)

- Smart Paste (`src/app/api/ai/format-report/route.ts`) is **markdown-first**: the
  LLM returns plain Markdown, code splits it on `##` into modules, and **every
  module is assigned `topTopics: []`** by design (manual pastes were assumed to
  skip topic extraction).
- The entire publish-time intelligence pipeline enters through
  `buildScannedTopicsFromModule` (`src/lib/topic-rankings/scan.ts`), which reads
  **only** `module.topTopics[]`. With `topTopics = []` it returns `[]`.
- Therefore at publish (`PUT /api/reports/[id]/publish` → `runCanonicalizeBlock`):
  `totalScanned = 0` → canonicalize has nothing to classify → `topic_rankings`
  stays empty → the dashboard trend chart's render gate (≥2 distinct week_labels
  + ≥1 non-null canonical key) is never met → and AI Insight news (which is
  generated from cross-week `topic_rankings` changes) produces nothing.
- The information the pipeline needs **is present** in the pasted report — but it
  is unstructured text, invisible to the structured `topTopics[]` contract. It is
  present in whatever shape the admin pasted: sometimes a Markdown table (rank /
  reason / keywords / heat level / misconception inside a module body), often
  free-form prose, bullets, or numbered paragraphs. A table is one shape among
  several, not a guarantee.
- An extraction approach gated on "a Markdown table is present, otherwise skip"
  would extract **nothing** from prose-form pastes — i.e. it would re-create the
  same invisibility for the common non-table case. The gate has to recognize
  topic content in any shape, not only tables.

### Direction (decided)

Identify and summarize `topTopics[]` during AI Format (Smart Paste) from the
top-topics content already in the pasted report body — **whatever shape that
content takes** (table, prose, bullet list, numbered paragraphs). This leans on
the LLM to identify and condense the top topics the way the auto-run report
synthesizer already does, rather than on deterministic table-row parsing. One
paste then yields **both** the readable markdown **and** the structured
`topTopics` the existing pipeline already consumes. No new downstream pipeline —
the manual report simply stops being invisible to the dictionary / trending /
news path that auto-run reports use.

A second, equally explicit outcome: a published manual report must **render its
topics the same way an auto-run report does** — through the structured
`TopTopicsTable` in `ReportRenderer`, with no manual-vs-auto visual distinction.
This is parity of presentation, parallel to the parity of pipeline above.

### Grounding facts (read before reviewing)

- `TopTopic` contract (`src/lib/validators/report-schema.ts`,
  `src/types/report.ts`): `{ rank: string (non-empty), topic: string (non-empty),
  voice_volume: number (>=0), keywords: string[] (<=10), seller_discussion:
  string, severity: 'high'|'medium'|'low', cross_engine_confirmed?: boolean }`.
  `ReportModuleV4Schema` caps `topTopics` at 10 per module. This contract and the
  cap are **unchanged** by this feature.
- The canonicalize prompt only consumes three fields per scanned topic
  (`buildScannedTopicsFromModule`): `topic_name_zh` ← `topic`, `summary_zh` ←
  `seller_discussion`, `keywords` ← `keywords`. The other `TopTopic` fields are
  used by the renderer (TopTopicsTable: rank, voice_volume, severity badge) but
  not by canonicalize.
- `voice_volume` does **not** feed Trending. The dashboard trend chart orders
  topics by `rank` from `topic_rankings` (`DashboardClient.tsx` maps
  `weekMap[week][canonical_key] = r.rank`; the chart's Y-axis is "Rank"), and
  `buildScannedTopicsFromModule` deliberately omits `voice_volume` from the
  scanned payload entirely. Consequently the prose `voice_volume = 0` default
  (R1.3) has **zero** effect on trending — it only affects the renderer's
  display. This is why getting **source-order `rank`** right matters (it drives
  the trend chart) while the volume default does not.
- The pasted top-topics content shape **varies**: a Markdown table, free-form
  prose, a bullet list, numbered paragraphs, or a mix. The feature must handle
  all of these, not only the table.
- An auto-run report does **not** get its `topTopics` from a table — the
  synthesizer identifies and summarizes the top topics out of the research
  engines' output. The manual path is being asked to do the analogous thing from
  the pasted content: identify and summarize, not only parse rows.
- The publish canonicalize block scans **only module indices 0 and 1**
  (`moduleIndices = [0, 1]` in `runCanonicalizeBlock`) — i.e. the first two
  modules (suspension trends, listing takedowns). Modules 2+ (tool feedback,
  education) are not part of canonicalize/trending today.
- Both the published `/reports/[id]` view and the new-report editor preview
  render a module's `topTopics[]` through the **same** structured component —
  `TopTopicsTable` inside `ReportRenderer`
  (`src/components/report/ReportRenderer.tsx`). Auto-run and manual reports share
  this exact render path. `MarkdownModuleCard` renders both `TopTopicsTable` (from
  `topTopics`) and the module's markdown body; when the pasted source was a
  Markdown table, the same topics therefore appear twice (structured table +
  in-body table). When the source was prose, the structured table is additive and
  there is no in-body duplicate.
- Smart Paste currently returns `{ title, dateRange, modules: [{ title,
  topTopics: [], markdown }] }`. Consumers (`admin/reports/new/page.tsx`,
  `ContentEditor`) drop the returned object straight into editor state.
- Bilingual is first-class (Principle 3): the pasted report may be Chinese or
  English; `content_translated` is produced later by a separate translate path.
  Extraction does not translate.
- Time-doesn't-matter for background work, but Smart Paste is an **interactive**
  endpoint — the admin is waiting on it. The reliable markdown backbone (Layer 1)
  must stay reliable independently of best-effort extraction (Layer 2).

## Glossary

- **Smart_Paste**: The "AI Format" feature on the new-report page that converts
  pasted raw report text into structured `ReportContent` via
  `POST /api/ai/format-report`.
- **Top_Topics_Source**: Any region of a module body that describes ranked or
  notable topics — a Markdown table, free-form prose, a bullet list, numbered
  paragraphs, or a mix. This is the general concept the feature identifies and
  extracts from. A `Top_Topics_Table` is one of its recognized shapes.
- **Top_Topics_Table**: One recognized shape of a `Top_Topics_Source` — a
  Markdown table inside a pasted report module body that ranks topics (columns
  typically: rank, core reason, keywords, heat level, misconception). Historically
  the only shape the feature handled; now one shape among several.
- **Top_Topics_Prose**: A `Top_Topics_Source` expressed as free-form prose,
  bullets, or numbered paragraphs rather than as a Markdown table. Carries no
  fixed columns, so rank / heat / volume may be implicit or absent.
- **Synthesizer**: The auto-run report pipeline step that produces `topTopics` by
  identifying and summarizing top topics from research-engine output (not from a
  table). The behavioral analogue the manual extraction path follows.
- **TopTopic**: The structured per-topic record (`rank`, `topic`, `voice_volume`,
  `keywords`, `seller_discussion`, `severity`, `cross_engine_confirmed?`) the
  renderer and the canonicalize pipeline consume.
- **Module**: One section of a report (`ReportModule`), produced by Smart_Paste's
  `##`-split. Has a `title`, a `markdown` body, and optionally `topTopics[]`.
- **Canonicalize_Pipeline**: The publish-time flow
  (`PUT /api/reports/[id]/publish` → `runCanonicalizeBlock` →
  `buildScannedTopicsFromModule` → `runWeeklyCanonicalize` →
  `persistWeeklyTopicRankings`) that classifies a report's `topTopics` into
  `topic_canonicals` and writes `topic_rankings`.
- **Report_Renderer**: The structured rendering path — the `TopTopicsTable`
  component inside `ReportRenderer` — used by both the published `/reports/[id]`
  view and the new-report editor preview to display a module's `topTopics[]`.
  Auto-run and manual reports share it.
- **Trending**: The dashboard weekly trend chart driven by `topic_rankings`.
- **AI_Insight_News**: News rows (`source_channel = 'AI Insight'`) generated at
  publish from cross-week `topic_rankings` changes.
- **Derived_Artifacts**: The data a report generates downstream at publish that
  is not part of the report body itself — specifically its `topic_rankings` rows
  (Trending) and its AI_Insight_News rows. Owned by the report that produced them.
- **Scanned_Module_Range**: The module indices the Canonicalize_Pipeline scans —
  today `[0, 1]`.
- **Report_Content**: The `{ title, dateRange, modules[] }` object Smart_Paste
  returns and the editor saves.
- **Admin**: An authenticated user with role admin (the only role that runs
  manual reports / publishes).

## Requirements

### Requirement 1: Identify and extract structured topics from the pasted top-topics source

**User Story:** As an Admin running a manual regular report, I want Smart_Paste to
read the top topics already described in my pasted text — whether they appear as a
table, prose, a bullet list, or numbered paragraphs — and produce structured
`topTopics`, so that my manual report carries the same structured data an auto-run
report does.

#### Acceptance Criteria

1. WHEN Smart_Paste processes pasted text in which a module contains a
   Top_Topics_Source, THE Smart_Paste SHALL populate that module's `topTopics[]`
   from that source instead of leaving it empty, regardless of whether the source
   is a Top_Topics_Table or Top_Topics_Prose.
2. THE Smart_Paste SHALL produce, for each identified topic, a TopTopic with all
   required fields present: `rank` (non-empty string), `topic` (non-empty string),
   `voice_volume` (number >= 0), `keywords` (string array, <= 10),
   `seller_discussion` (string), and `severity` (one of high/medium/low).
3. WHERE the Top_Topics_Source provides a heat/volume value, THE Smart_Paste SHALL
   map it to `voice_volume`; WHERE no numeric volume signal is present (including
   prose that states no heat or volume), THE Smart_Paste SHALL set `voice_volume`
   to 0.
4. WHERE the Top_Topics_Source provides a severity/heat level, THE Smart_Paste
   SHALL map it to `severity` using high/medium/low; WHERE severity cannot be
   determined (including prose that states no heat signal), THE Smart_Paste SHALL
   default `severity` to a single documented value rather than omitting the field.
5. THE Smart_Paste SHALL cap extracted `topTopics` at 10 per module (the
   `ReportModuleV4Schema` limit), keeping the highest-ranked topics when a source
   yields more than 10. THE `rank` of each TopTopic SHALL be the topic's order of
   appearance in the Top_Topics_Source: WHERE the source carries explicit
   numbering (a rank column in a Top_Topics_Table, or 1/2/3 ordinals in
   Top_Topics_Prose), THE Smart_Paste SHALL use that number; otherwise THE
   Smart_Paste SHALL assign `rank` by the order in which topics appear in the
   source. This rule applies identically to every source shape (table and prose
   alike). THE Smart_Paste SHALL NOT re-rank topics or substitute its own
   importance judgment for the source order — source order is the author's
   ranking.
6. THE Smart_Paste SHALL preserve the existing markdown body of the module
   unchanged when it also extracts `topTopics` — extraction adds structured data,
   it does not remove or rewrite the prose.

### Requirement 2: Identify which module's topic source feeds the pipeline, in any shape

**User Story:** As an Admin, I want the topics from the right section to feed
trending, so that the dictionary classification reflects the suspension/listing
trends the pipeline expects, whether I pasted them as a table or as prose.

#### Acceptance Criteria

1. THE Smart_Paste SHALL extract `topTopics` for modules within the
   Scanned_Module_Range so that the extracted topics actually reach the
   Canonicalize_Pipeline.
2. WHERE the pasted report's section order does not match the canonical
   suspension-then-listing order the pipeline assumes, THE feature SHALL provide a
   documented behavior (the product owner SHALL confirm whether extraction applies
   to all modules that contain a Top_Topics_Source, or only the first N) so topics
   are not silently dropped because they sit in an out-of-range module.
3. WHERE a module in the Scanned_Module_Range contains no recognizable
   Top_Topics_Source in any shape (no table and no topic-describing prose), THE
   Smart_Paste SHALL leave that module's `topTopics` empty and SHALL NOT fabricate
   topics.
4. THE Smart_Paste SHALL NOT gate extraction solely on the presence of a Markdown
   table; THE Smart_Paste SHALL also extract topics from Top_Topics_Prose. THE
   design MAY choose the detection mechanism — for example, attempting extraction
   on every in-scope module and letting the LLM return an empty result when there
   is genuinely no topic content, or a cheap topic-content detector that runs
   before the extraction call — PROVIDED the required outcome holds (prose-form
   topic content is extracted) together with the safety rail (no topics are
   fabricated when there is genuinely no topic content).

### Requirement 3: Grounded extraction — faithful to the pasted content, condensed but never invented

**User Story:** As an Admin, I want the extracted topics to be grounded in what I
pasted — condensed where my source is prose, but never invented — so that the
trending and news downstream are trustworthy.

#### Acceptance Criteria

1. THE Smart_Paste SHALL ground every extracted TopTopic in the pasted
   Top_Topics_Source and SHALL NOT introduce topics, keywords, or numbers that are
   not supported by the pasted content.
2. WHERE the Top_Topics_Source is Top_Topics_Prose, THE Smart_Paste MAY condense
   or summarize that content into a topic name, a `seller_discussion`, and
   `keywords`, PROVIDED each resulting value is supported by the pasted content.
3. THE Smart_Paste SHALL set `voice_volume` and `severity` only from values the
   pasted content supports; WHERE the content provides no such signal, THE
   Smart_Paste SHALL apply the documented default (R1.3 / R1.4) rather than
   inventing a number or a level.
4. WHERE a Top_Topics_Source field or cell is empty or absent, THE Smart_Paste
   SHALL apply the documented default for that field (R1.3 / R1.4) rather than
   inventing a value.
5. IF a module contains genuinely no topic content in any shape, THEN THE
   Smart_Paste SHALL produce empty `topTopics` for that module and SHALL NOT invent
   topics.
6. THE Smart_Paste SHALL keep the topic text in its original language (Chinese
   stays Chinese, English stays English), consistent with the markdown body and
   with Principle 3 (no translation during extraction).

### Requirement 4: Manual report flows through the existing pipeline at publish

**User Story:** As an Admin, I want a published manual report to classify into the
dictionary, appear in trending, and generate AI Insight news, so that a
copy-paste report behaves like an auto-run report.

#### Acceptance Criteria

1. WHEN an Admin publishes a manual report whose modules carry extracted
   `topTopics` (from a table or from prose), THE Canonicalize_Pipeline SHALL
   receive a non-empty scanned-topics payload (i.e. `buildScannedTopicsFromModule`
   returns the extracted topics).
2. WHEN the Canonicalize_Pipeline runs on a manual report with extracted topics,
   THE system SHALL write `topic_rankings` rows for that report's domain and week
   the same way it does for an auto-run report.
3. WHERE the manual report's `topic_rankings` plus prior weeks meet the existing
   Trending render gate, THE dashboard SHALL render the manual report's topics in
   the trend chart with no manual-vs-auto distinction.
4. WHERE cross-week `topic_rankings` changes exist after publishing a manual
   report, THE AI_Insight_News generation SHALL run on the same data it uses for
   auto-run reports.
5. THE feature SHALL NOT add a parallel classification path — extracted topics use
   the same `buildScannedTopicsFromModule` → `runWeeklyCanonicalize` →
   `persistWeeklyTopicRankings` flow (one topic dictionary invariant).

### Requirement 5: Graceful when no topic content is present

**User Story:** As an Admin pasting a report that has no top-topics content, I want
Smart_Paste to still work, so that extraction never breaks the basic paste.

#### Acceptance Criteria

1. WHERE pasted text contains no recognizable Top_Topics_Source in any module (no
   table and no topic-describing prose), THE Smart_Paste SHALL still return valid
   Report_Content with module markdown intact and `topTopics` empty (current
   behavior preserved).
2. IF extraction fails or produces an invalid TopTopic structure, THEN THE
   Smart_Paste SHALL fall back to returning the affected module with empty
   `topTopics` rather than failing the whole paste.
3. THE Smart_Paste SHALL surface a non-blocking indication to the Admin of how
   many topics were extracted (so a silent zero-extraction is observable before
   publish).
4. IF extraction fails or produces an invalid TopTopic structure for an in-scope
   module (the R5.2 fallback path), THEN THE Smart_Paste SHALL mark that module's
   extraction outcome as failed within the same non-blocking indication of R5.3,
   distinct from a module that genuinely contained no Top_Topics_Source, so that
   the Admin can distinguish an extraction failure from a genuine absence of
   topics before publishing, AND THE Smart_Paste SHALL still return valid
   Report_Content (the paste still succeeds).

### Requirement 6: Reliability of the extraction (Principle 2 — constraint over prompt-hope)

**User Story:** As an Admin, I want extraction to be reliable, so that I don't get
malformed structured data that breaks publish.

#### Acceptance Criteria

1. THE Smart_Paste SHALL validate extracted `topTopics` against the TopTopic
   schema before returning them, and SHALL drop or repair any topic that fails
   validation rather than returning an invalid structure.
2. WHERE extraction uses an LLM step, THE Smart_Paste SHALL constrain that step's
   output with an API-level JSON constraint (`response_format`) rather than relying
   on prompt instructions alone, consistent with the platform's other structured
   LLM calls.
3. THE Smart_Paste SHALL keep markdown-body production and `topTopics` extraction
   reliable independently — a failure in topic extraction SHALL NOT corrupt or
   block the markdown body (which itself must not regress to the JSON-string
   fragility that markdown-first removed).
4. THE Smart_Paste SHALL perform any prose summarization inside the
   API-constrained LLM call, and THE code SHALL own schema validity through the
   validate/drop/repair pass of R6.1 — i.e. the LLM owns summarization quality,
   the code owns structural correctness.

### Requirement 7: Editability of extracted topics before publish

**User Story:** As an Admin, I want to review and correct the extracted topics
before publishing, so that I can fix a mis-parsed row or a mis-summarized topic.

#### Acceptance Criteria

1. WHEN Smart_Paste returns extracted `topTopics`, THE new-report editor SHALL
   make them visible to the Admin prior to publish.
2. THE editor SHALL allow the Admin to correct or remove an extracted TopTopic
   before publishing.
3. WHERE the Admin edits an extracted TopTopic, THE saved Report_Content SHALL
   carry the edited values into the Canonicalize_Pipeline at publish.
4. THE editor SHALL present extracted topics for review and correction identically
   whether they were extracted from a Top_Topics_Table or summarized from
   Top_Topics_Prose.

### Requirement 8: Rendering parity with auto-run reports

**User Story:** As an Admin, I want a published manual report's topics to render
the same way an auto-run report's topics render, so that readers see one
consistent presentation regardless of how the report was produced.

#### Acceptance Criteria

1. WHEN an Admin publishes a manual report whose modules carry extracted
   `topTopics`, THE published `/reports/[id]` view SHALL render those topics
   through the same Report_Renderer structured path (`TopTopicsTable` within
   `ReportRenderer`) that auto-run reports use.
2. THE Report_Renderer SHALL present manual-report topics with the same component,
   layout, and styling as auto-run-report topics, so that the topics presentation
   carries no manual-vs-auto visual distinction (parity of presentation, parallel
   to Requirement 4's parity of pipeline).
3. THE new-report editor preview SHALL render extracted `topTopics` through the
   same Report_Renderer structured path, so that the Admin previews the published
   presentation before publishing.
4. WHERE the Top_Topics_Source was a Top_Topics_Table, THE published view SHALL
   render the topics readably even though both the structured `TopTopicsTable` and
   the in-body markdown table present the same topics (a known duplicate; see the
   note below).
5. WHERE the Top_Topics_Source was Top_Topics_Prose, THE structured `TopTopicsTable`
   SHALL render the topics additively, with no duplicate table in the module body.

> **Known consideration (deferred to design, not over-constrained here):** When the
> source was a Markdown table, R1.6 keeps the in-body table verbatim while R8.1
> also renders the structured `TopTopicsTable`, so a table-sourced manual report
> shows its topics twice. The requirement fixes the *outcome* — the rendered result
> must stay readable and must not confuse the reader — and deliberately does **not**
> mandate a mechanism. The design decides whether to de-duplicate (for example, by
> suppressing a leading in-body table when `topTopics` is present) or to accept the
> duplicate; either choice is acceptable as long as R8.4 holds. A prose source has
> no duplicate, so de-duplication is a table-source-only concern.

### Requirement 9: Derived artifacts are owned by the report — idempotent publish and cascade delete

**User Story:** As an Admin who re-publishes and edits-then-republishes manual
reports as a normal workflow, I want a report's derived artifacts (its trending
rows and its AI Insight news) to live and die with the report, so that
re-publishing never accumulates duplicates and deleting a report never leaves
orphaned data behind.

> **Why this requirement exists now (grounded in current code):** `topic_rankings`
> already links to its report via `report_id`, and the persist RPC
> (`persist_weekly_topic_rankings`, migration 026b/026c) is already idempotent — it
> runs `DELETE FROM topic_rankings WHERE report_id = p_report_id` then re-inserts,
> and a report delete cascades its rankings. **AI_Insight_News does not have this
> link.** The `news` table (migration 001) references only `domain_id`
> (`ON DELETE CASCADE` to `domains`), and the publish route inserts AI Insight rows
> with `domain_id` + `created_by` and **no reference back to the originating
> report**. Two consequences follow directly: (a) re-publishing a report
> re-INSERTs duplicate AI Insight news rows (not idempotent), and (b) deleting a
> report leaves its AI Insight news orphaned (no cascade). This is a **pre-existing
> structural gap** that this feature surfaces, because Smart Paste makes
> re-publish / edit-and-republish (Requirement 7) a **primary workflow** rather
> than the rare event it was for auto-run reports. The product owner DECIDED
> **option A (hard cascade)**: a report OWNS its Derived_Artifacts. The owner
> explicitly accepted that hard cascade MAY silently remove an AI Insight news item
> a reader had already seen — that tradeoff is accepted in favor of "the report is
> the source of truth; its derived artifacts live and die with it."

#### Acceptance Criteria

1. WHEN an Admin re-publishes a report, THE system SHALL replace (not append) that
   report's AI_Insight_News rows, so that no duplicate AI_Insight_News
   accumulates across re-publishes — parallel to the existing
   `topic_rankings` DELETE-by-`report_id`-then-insert idempotency.
2. WHEN an Admin deletes a report, THE system SHALL cascade-delete that report's
   `topic_rankings` rows AND that report's AI_Insight_News rows.
3. THE AI_Insight_News rows generated from a report's topic-ranking changes SHALL
   carry a reference back to their originating report, so that both the
   idempotent-replace behavior (R9.1) and the cascade-delete behavior (R9.2) are
   enforceable at the data layer rather than by application guesswork.
4. THE system SHALL enforce R9.1 and R9.2 without adding a parallel classification
   or news-generation path — this requirement adds an ownership link from
   AI_Insight_News back to its report; it does not change the single
   Canonicalize_Pipeline flow (R4.5's one-topic-dictionary invariant remains
   intact) and does not alter that a manual report still flows through the existing
   pipeline at publish (R4).
5. WHERE the owner's accepted tradeoff applies (R9.2 hard cascade removes an
   AI_Insight_News item a reader may already have seen), THE system SHALL still
   perform the cascade delete, treating the report as the source of truth for its
   Derived_Artifacts.
