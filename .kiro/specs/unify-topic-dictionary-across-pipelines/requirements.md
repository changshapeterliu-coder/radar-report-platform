# Requirements Document

## Introduction

This feature unifies topic classification across the platform's two topic-producing pipelines so that the daily hot-topic alert and the weekly regular report share **one canonicalization prompt**, **one canonical dictionary**, and **one set of axis / bucket rules**. The user-visible payoff is that the dashboard's cross-week trend chart legend stops drifting (because `canonical_topic_key` replaces the unstable LLM-minted `topic_label`), and the same problem class scanned in daily and weekly converges to the same key.

Before this feature, the two pipelines diverged. The daily pipeline (mature) writes to `topic_canonicals` via `daily_canonicalization_prompt`, with bucket gating (`account_suspension` / `listing_takedown`) and a secondary axis (`site` / `category`). The weekly publish path uses an **ad-hoc, in-prompt canonicalization** inside the `extract.ts` LLM call, persisting fresh English `topic_label` strings into `topic_rankings` on every run — there is no shared dictionary, no bucket gate, and no axis taxonomy. Trend chart legends therefore vary across weeks and never align with daily-pipeline labels.

The fix is structural rather than prompt-level. Both pipelines call the same `daily_canonicalization_prompt`, both write into and read from `topic_canonicals`, both apply the bucket gate, and the dashboard's join key changes from `topic_label` to `canonical_topic_key`. `reports.content` is **not** mutated — the canonical classification is stored separately in `topic_rankings` (via composite FK to `topic_canonicals`) and rendered as an additional UI column to the right of the existing Topic column.

The schema change to `topic_rankings` is breaking (drop `topic_label` / `topic_label_zh`, add `canonical_topic_key`), the existing 18 W17/W19 rows must be re-extracted, and the migration must be ordered so the dashboard never reads from a half-migrated state.

### Scope

**In scope (V1)**

- Widen `topic_canonicals.origin` CHECK to accept `'weekly_report'`
- Replace ad-hoc weekly canonicalization in `src/lib/topic-rankings/extract.ts` with the shared canonicalization flow (load `daily_canonicalization_prompt` from `prompt_templates`, classify against `topic_canonicals` history for the domain, mint new canonicals with `origin='weekly_report'`)
- Apply the bucket gate (`account_suspension` / `listing_takedown`) to weekly topics — drop topics that fit neither
- Replace `topic_rankings.topic_label` + `topic_label_zh` with `canonical_topic_key` (composite FK to `topic_canonicals`)
- Migrate the dashboard trend chart and the dashboard summary tables (Module1 / Module2) to read by `canonical_topic_key`, with legend / display strings resolved from `topic_canonicals.canonical_title_zh` / `_en` per UI language
- Render a new `"类别 / Category"` column in the dashboard summary tables AND in the report-detail page (`/reports/[id]`) module tables, positioned immediately to the right of the existing Topic column. For dropped topics show `"—"` with a tooltip carrying `drop_reason`
- Backfill the 18 existing `topic_rankings` rows for W17 and W19 (domain `Account Health`) by deleting and re-extracting them through the new shared canonicalization flow; the two affected report rows (`b0c05dae-…` W17 and `f8b2ea58-…` W19) stay published
- Fan out newly-minted weekly canonicals to the existing `topic_canonicals` translate Inngest path so `_en` populates asynchronously
- Loud Vercel-log telemetry on the publish path so canonicalize failures stop being silent
- Bilingual UI for the new `"类别 / Category"` column (Chinese-primary, English fallback with `(Chinese original)` indicator)

**Out of scope (V1)**

- Changes to the daily-alert pipeline — daily already runs the shared flow; this spec only **adds** weekly as a second writer
- Admin-editable `daily_canonicalization_prompt` UI changes (same admin surface as today; only the prompt's body is now used by two callers)
- A separate `weekly_canonicalization_prompt` — explicitly rejected
- Mutation of `reports.content` or any change to weekly synthesizer prompts
- Rewriting historical weekly reports prior to W17 (none exist for the only domain currently using weekly publish)
- Multi-domain rollout planning beyond `Account Health` — the per-domain `(domain_id, canonical_topic_key)` UNIQUE constraint already isolates dictionaries per domain
- Concurrency control beyond what the existing FK + UNIQUE constraints provide (the publish path is admin-triggered and not high-concurrency in practice)

## Glossary

- **Canonical** — A persistent row in `topic_canonicals` representing one "problem class + sub-area (+ optional secondary axis)" category for a domain. Holds the stable bilingual class title and description that every per-day or per-week topic linked to it shares. Created the first time a class is identified; reused thereafter.
- **canonical_topic_key** — Stable string identifier for a Canonical within a domain. Format `{category_slug}` or `{category_slug}::{secondary_axis_value}` matching the regex `^[a-z0-9-]+(::[A-Za-z0-9-]+)?$`. Unique on `(domain_id, canonical_topic_key)`.
- **category_slug** — Lowercase hyphen-separated English slug naming the topic axis (problem class + sub-area). Example values: `account-health-score-rules`, `kyc-verification`, `product-compliance`.
- **secondary_axis** — Optional second discriminator on a Canonical. `secondary_axis_type` is either `'site'` (Amazon marketplace, e.g. `BR`, `CA`, `US`, `UK`, `DE`) or `'category'` (product type, e.g. `toys-battery`, `food`, `cosmetics`), or NULL when no obvious sub-axis applies. `secondary_axis_value` is paired with `secondary_axis_type` (both NULL or both non-NULL — enforced by table CHECK).
- **bucket** — The two-bucket business focus gate enforced by `daily_canonicalization_prompt`. `account_suspension` covers consequences at the account level (suspension, audit, fund freeze, AHR drop). `listing_takedown` covers consequences at the listing level (block, removal, sale-freeze). Topics fitting neither receive `decision='drop'`.
- **decision** — Per-topic verdict produced by the Canonicalization_Engine. Either `'keep'` (the topic fits a bucket and gets a canonical assignment) or `'drop'` (the topic fits no bucket and never reaches the persisted topic table — but is logged with a `drop_reason`).
- **drop_reason** — Single-sentence string returned by the Canonicalization_Engine for every `decision='drop'` topic, surfaced in run logs and rendered as the tooltip text on the dropped-topic placeholder in the UI.
- **origin** — `topic_canonicals.origin` column, identifies which pipeline minted the canonical row. V0 (today) only emits `'daily_alert'`. V1 (this spec) widens the CHECK to also accept `'weekly_report'`. The column is never mutated after creation.
- **dictionary** — Synonym for the entire `topic_canonicals` table, scoped per domain via `(domain_id, canonical_topic_key)` UNIQUE.
- **topic_canonicals** — Platform-level canonical dictionary table (created in migration 015). Holds one row per `(domain_id, canonical_topic_key)`. Schema referenced throughout this spec.
- **topic_rankings** — Per-report, per-module ranked-topic table. After this spec: drops `topic_label` and `topic_label_zh`, adds `canonical_topic_key VARCHAR(120)` with composite FK `(domain_id, canonical_topic_key) → topic_canonicals (domain_id, canonical_topic_key)` ON DELETE RESTRICT. The dashboard joins on this column.
- **Daily_Alert_Pipeline** — Mature pipeline producing daily alerts (spec: `.kiro/specs/daily-hot-topic-alert/`). Already calls the shared canonicalization flow. Not modified by this spec.
- **Weekly_Publish_Pipeline** — The pipeline triggered by `PUT /api/reports/[id]/publish` that today calls `extractAndPersistTopicRankings` (`src/lib/topic-rankings/extract.ts` + `persist.ts`). Modified by this spec to call the shared Canonicalization_Engine instead of an ad-hoc LLM call.
- **Canonicalization_Engine** — The single LLM call (with `response_format: json_object`) that takes (a) freshly-scanned topics and (b) the full list of existing canonicals for the domain, and returns per-topic decisions / canonical assignments. The prompt body is shared between pipelines (the `daily_canonicalization_prompt` row in `prompt_templates`), but **the LLM provider is a per-pipeline implementation choice**. Today: Daily_Alert_Pipeline uses Z.AI / GLM-4.6 (via `zai-client.ts`); Weekly_Publish_Pipeline uses OpenRouter (matching its existing `src/lib/topic-rankings/extract.ts` path). What's shared is the prompt text and the response schema, not the wire-level provider.
- **daily_canonicalization_prompt** — The single canonicalization prompt body in `prompt_templates`. Despite the historical name, it is the **shared** prompt used by both Daily_Alert_Pipeline and Weekly_Publish_Pipeline after this spec. Admin edits it once, both pipelines pick up the change.
- **Trend_Chart** — The dashboard's cross-week line chart (`src/app/(main)/dashboard/page.tsx`) that historically grouped `topic_rankings` rows by `topic_label` to draw one line per topic across weeks. After this spec it groups by `canonical_topic_key` and draws the legend label from `topic_canonicals.canonical_title_zh` / `canonical_title_en`.
- **Topic_Column** — The existing column in dashboard summary tables (`Module1` / `Module2`) and in the report-detail page (`/reports/[id]`) module tables that currently displays the per-week topic name. Unchanged by this spec.
- **Category_Column** — The new column introduced by this spec, header `"类别"` (zh) / `"Category"` (en), positioned immediately to the right of Topic_Column. Renders the resolved canonical title (or `"—"` with hover-tooltip `drop_reason` when the topic was dropped).
- **Admin** — User with `role='admin'` in the `profiles` table.

## Requirements

### Requirement 1: Single Shared Canonicalization Prompt

**User Story:** As an admin, I want one canonicalization prompt that governs both pipelines, so that editing it once aligns daily and weekly classification without me chasing two divergent prompt bodies.

#### Acceptance Criteria

1. THE Weekly_Publish_Pipeline SHALL load the canonicalization prompt body from `prompt_templates` filtered by `prompt_type='daily_canonicalization_prompt'` AND `domain_id` matching the report's domain.
2. THE System SHALL NOT introduce a `prompt_type='weekly_canonicalization_prompt'` row, table, or hard-coded prompt string anywhere in the Weekly_Publish_Pipeline.
3. WHEN an admin updates the `daily_canonicalization_prompt` row for a domain, THE Weekly_Publish_Pipeline SHALL use the new text on the next publish for that domain without code changes or redeploys. WHEN the admin update happens **mid-publish** (a publish run already loaded the old prompt), THAT run SHALL complete with the old prompt body it read at the start; only the next publish SHALL pick up the new text.
4. THE Weekly_Publish_Pipeline SHALL substitute the same `{scanned_topics_json}` and `{existing_canonicals_json}` placeholders the Daily_Alert_Pipeline substitutes, so a single prompt body works for both callers.
5. IF the resolved `daily_canonicalization_prompt` row is missing for the report's `domain_id`, THEN THE Weekly_Publish_Pipeline SHALL mark the canonicalization step as failed with `failure_reason` containing the literal phrase `"daily_canonicalization_prompt missing for domain"` and SHALL NOT fall back to any in-code prompt string.

### Requirement 2: Single Shared Topic Dictionary

**User Story:** As a platform owner, I want one dictionary across pipelines, so that the same problem class scanned by daily and weekly converges to the same `canonical_topic_key`.

#### Acceptance Criteria

1. THE Weekly_Publish_Pipeline SHALL read existing canonicals from `topic_canonicals` filtered by the report's `domain_id` (no other filter on `origin`) when building the Canonicalization_Engine's `existing_canonicals_json` payload.
2. WHEN the Canonicalization_Engine returns a `canonical_topic_key` that already exists in `topic_canonicals` for the same `domain_id`, THE Weekly_Publish_Pipeline SHALL reuse the existing row and SHALL NOT mutate its `canonical_title_zh`, `canonical_title_en`, `canonical_description_zh`, `canonical_description_en`, `category_slug`, `secondary_axis_type`, `secondary_axis_value`, OR `origin` fields.
3. WHEN the Canonicalization_Engine proposes a brand-new `canonical_topic_key` for a weekly topic, THE Weekly_Publish_Pipeline SHALL insert a new row into `topic_canonicals` with `origin='weekly_report'`, `first_seen_date = today (Asia/Shanghai)`, `last_seen_date = today (Asia/Shanghai)`, `seen_count = 1`, AND the engine-supplied `category_slug` / `secondary_axis_type` / `secondary_axis_value` / `canonical_title_zh` / `canonical_description_zh`.
4. WHEN a weekly publish reuses an existing `topic_canonicals` row, THE Weekly_Publish_Pipeline SHALL update only `last_seen_date` (to today's Asia/Shanghai date) AND increment `seen_count` by 1 per distinct weekly topic that resolves to that key.
5. THE topic dictionary SHALL remain scoped per domain via the existing `UNIQUE (domain_id, canonical_topic_key)` constraint; THE Weekly_Publish_Pipeline SHALL NOT bypass or weaken this constraint.

### Requirement 3: Widen `topic_canonicals.origin` CHECK Constraint

**User Story:** As a developer, I want the `origin` CHECK constraint widened ahead of any weekly write, so that the first weekly publish under the new pipeline doesn't fail with a constraint violation.

#### Acceptance Criteria

1. THE System SHALL ship a migration that drops the existing CHECK constraint on `topic_canonicals.origin` AND replaces it with a CHECK accepting exactly the set `{'daily_alert', 'weekly_report'}`.
2. THE migration SHALL run BEFORE any code deployment that issues an `INSERT INTO topic_canonicals (..., origin) VALUES (..., 'weekly_report')`.
3. THE migration SHALL update the `COMMENT ON COLUMN topic_canonicals.origin` to remove the "reserved future value" wording for `'weekly_report'` and reflect that both values are now active.
4. THE migration SHALL be re-run-safe (using a guarded `ALTER TABLE ... DROP CONSTRAINT IF EXISTS` followed by `ADD CONSTRAINT`).
5. THE migration SHALL NOT modify any existing row in `topic_canonicals` — historical `'daily_alert'` rows remain unchanged.
6. After applying the migration, the SQL `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname LIKE '%topic_canonicals%origin%';` SHALL return a definition referencing both `'daily_alert'` AND `'weekly_report'` — this is the manual verification step the operator runs.

### Requirement 4: Bucket Gating on Weekly Publish

**User Story:** As a member of the CN-seller support team, I want weekly trend topics filtered by the same two-bucket business focus rule the daily alert applies, so that off-topic items (ad-account discussions, generic SEO posts, performance metrics without account consequences) don't pollute the trend chart.

#### Acceptance Criteria

1. WHEN the Weekly_Publish_Pipeline runs the Canonicalization_Engine, THE engine output SHALL carry a `decision` field per topic with value `'keep'` or `'drop'`, AND a `bucket` field with value `'account_suspension'` / `'listing_takedown'` / `null` matching the existing daily output schema.
2. WHEN a weekly topic returns `decision='drop'`, THE Weekly_Publish_Pipeline SHALL NOT insert a row into `topic_rankings` for that topic.
3. WHEN a weekly topic returns `decision='drop'`, THE Weekly_Publish_Pipeline SHALL log the topic's source identity (module index, original topic string) AND `drop_reason` to Vercel logs at `console.warn` level so dropped topics are auditable.
4. THE Weekly_Publish_Pipeline SHALL NOT mutate, redact, or otherwise alter `reports.content` based on the bucket-gate result — the report's published markdown / `topTopics` keep showing every topic the synthesizer wrote, including those subsequently dropped from `topic_rankings`.
5. WHEN every topic in a module returns `decision='drop'`, THE Weekly_Publish_Pipeline SHALL persist zero `topic_rankings` rows for that module AND SHALL log a single `console.warn` line summarising "module N dropped K of K topics" so an empty trend slice is observable.

### Requirement 5: Same Axis Taxonomy as Daily

**User Story:** As a platform owner, I want weekly canonicals to use the same axes as daily, so that one canonical produced by daily and another produced by weekly stay interchangeable when aggregated.

#### Acceptance Criteria

1. WHEN the Weekly_Publish_Pipeline persists a new canonical row, THE `category_slug` SHALL match the regex `^[a-z0-9-]+$` (the existing CHECK constraint).
2. WHEN the Weekly_Publish_Pipeline persists a new canonical row, THE `secondary_axis_type` SHALL be one of `'site'`, `'category'`, OR `null`, AND THE `secondary_axis_value` SHALL satisfy the existing axis-consistency CHECK (both NULL or both non-NULL).
3. WHEN `secondary_axis_type='site'`, THE Weekly_Publish_Pipeline SHALL accept `secondary_axis_value` matching a 2-letter Amazon marketplace code in upper case (`BR`, `CA`, `US`, `UK`, `DE`, `JP`, `MX`, `FR`, `IT`, `ES`, `AU`, `IN`, `NL`, `SE`, `PL`, `TR`, `SG`, `AE`, `BE`).
4. WHEN `secondary_axis_type='category'`, THE Weekly_Publish_Pipeline SHALL accept `secondary_axis_value` matching the regex `^[a-z0-9-]+$` (lowercase hyphen-separated slug, e.g. `toys-battery`, `food`, `cosmetics`).
5. WHEN the Canonicalization_Engine returns a `canonical_topic_key` that does not match the regex `^[a-z0-9-]+(::[A-Za-z0-9-]+)?$`, THE Weekly_Publish_Pipeline SHALL normalise the key by lowercasing the primary segment and trimming whitespace; if normalisation cannot produce a valid key, THE pipeline SHALL drop **only that single topic** with `failure_reason` containing `"weekly canonicalize: malformed key"` written to logs (per Requirement 11.3) AND SHALL continue processing the remaining topics in the same run — partial success is preferred over an all-or-nothing failure here.

### Requirement 6: Auto-Create Canonicals — No Admin Approval Gate

**User Story:** As an admin, I don't want to approve every new weekly canonical, so that the publish flow stays self-service and topic discovery scales without my involvement.

#### Acceptance Criteria

1. WHEN the Canonicalization_Engine proposes a brand-new `canonical_topic_key` during a weekly publish, THE Weekly_Publish_Pipeline SHALL persist the new `topic_canonicals` row inline within the same publish request with `origin='weekly_report'` AND no human-review step.
2. THE Weekly_Publish_Pipeline SHALL use `INSERT ... ON CONFLICT (domain_id, canonical_topic_key) DO NOTHING` semantics for new canonical inserts, so two concurrent publishes proposing the same key cannot produce duplicate rows.
3. WHEN an `ON CONFLICT DO NOTHING` insert silently no-ops because another concurrent run already inserted the same key, THE Weekly_Publish_Pipeline SHALL re-read the canonical row from `topic_canonicals` AND treat the conflict as a "reuse" branch (the topic's own `topic_rankings` row points to the existing canonical, not to a new one).
4. THE Weekly_Publish_Pipeline SHALL NOT call the email or in-app notification system to flag newly-minted weekly canonicals — discovery is observable through Vercel logs (per Requirement 11) and through the dictionary itself, not via push.

### Requirement 7: `reports.content` Is Immutable Post-Publish

**User Story:** As a member of the CN-seller support team, I want the published report markdown to keep saying exactly what the synthesizer wrote, so that I can quote it as-is and the reading experience matches what was reviewed at draft time.

#### Acceptance Criteria

1. WHEN the Weekly_Publish_Pipeline runs canonicalization and persists `topic_rankings`, THE pipeline SHALL NOT issue `UPDATE` against `reports.content`, `reports.content_translated`, OR `reports.title`.
2. THE Weekly_Publish_Pipeline SHALL NOT inject canonical_title strings, bucket labels, or drop-reason text into `reports.content` — the canonical projection is rendered at the UI layer per Requirement 9, not stored inside the report body.
3. IF the canonicalization step fails after the report's `status` was already updated to `'published'`, THEN THE System SHALL leave the report published AND SHALL log the canonicalization failure (per Requirement 11). The report's body remains intact; only `topic_rankings` is left empty for that publish. IF the failure-logging itself fails (e.g. log infra outage), THEN THE System SHALL still leave the report published — the audit trail of the failure is best-effort, never a gate on publish state.
4. WHEN a weekly report is re-published (same report id, manual re-trigger), THE Weekly_Publish_Pipeline SHALL delete the prior `topic_rankings` rows for that `report_id` BEFORE inserting the new canonicalized rows — `reports.content` remains untouched.

### Requirement 8: `topic_rankings` Schema Breaking Change

**User Story:** As a developer, I want `topic_rankings` restructured to reference `topic_canonicals` directly, so that the dashboard's cross-week join becomes stable and I never have to babysit drifting English `topic_label` strings again.

#### Acceptance Criteria

1. THE System SHALL ship a migration that adds `canonical_topic_key VARCHAR(120) NULL` to `topic_rankings`.
2. THE migration SHALL add a composite foreign key `FOREIGN KEY (domain_id, canonical_topic_key) REFERENCES topic_canonicals (domain_id, canonical_topic_key) ON DELETE RESTRICT`.
3. THE migration SHALL drop the columns `topic_label` AND `topic_label_zh` from `topic_rankings`.
4. AFTER the column drop, THE `canonical_topic_key` column SHALL be altered to `NOT NULL` — every persisted topic ranking row SHALL reference exactly one canonical row.
5. THE migration SHALL preserve the existing columns `id`, `report_id`, `domain_id`, `module_index`, `rank`, `week_label`, `raw_reason`, `raw_keywords`, `created_at` unchanged.
6. THE generated `Database['public']['Tables']['topic_rankings']` TypeScript types SHALL be updated in the same commit as the migration AND code-deploy that begins writing the new shape — the old type signature with `topic_label` SHALL NOT remain in `src/types/database.ts` after the migration runs.
7. ON DELETE RESTRICT SHALL prevent any future delete of a `topic_canonicals` row that still has live `topic_rankings` references — the migration SHALL surface this as a deliberate FK behaviour, not an oversight.

### Requirement 9: Migration Ordering and Manual Verification

**User Story:** As an operator, I want the schema change rolled out in a sequence that never leaves the dashboard reading from a half-migrated state, so that production never serves a broken trend chart.

#### Acceptance Criteria

1. THE System SHALL execute the rollout in exactly this ordered sequence: (a) widen `topic_canonicals.origin` CHECK to include `'weekly_report'`; (b) add nullable `topic_rankings.canonical_topic_key` column + composite FK + supporting index; (c) deploy code that, on every weekly publish, populates `canonical_topic_key` (and continues to populate `topic_label` / `topic_label_zh` for read compatibility during the transition); (d) backfill the 18 existing W17/W19 rows per Requirement 12 and confirm 100% coverage of `canonical_topic_key`; (e) swap the dashboard's read path to use `canonical_topic_key`; (f) deploy code that stops writing `topic_label` / `topic_label_zh`; (g) run the migration that drops `topic_label` / `topic_label_zh` and sets `canonical_topic_key` to `NOT NULL`.
2. THE System SHALL NOT proceed from any step to the next until the prior step's manual verification check passes.
3. AFTER step (a), THE manual verification SHALL be the SQL `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'topic_canonicals'::regclass AND conname LIKE '%origin%';` — the result SHALL include both `'daily_alert'` AND `'weekly_report'`.
4. AFTER step (b), THE manual verification SHALL be the SQL `SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name = 'topic_rankings' AND column_name = 'canonical_topic_key';` — the result SHALL show `is_nullable='YES'` and `data_type='character varying'`.
5. AFTER step (d), THE manual verification SHALL be the SQL `SELECT count(*) FROM topic_rankings WHERE canonical_topic_key IS NULL;` — the result SHALL be `0`.
6. AFTER step (g), THE manual verification SHALL be the SQL `SELECT column_name FROM information_schema.columns WHERE table_name = 'topic_rankings' AND column_name IN ('topic_label', 'topic_label_zh');` — the result SHALL be empty (zero rows).
7. THE step (c) → (g) deploys SHALL be reversible by `git revert` of the corresponding commits; the migrations from step (a), (b), and (g) SHALL each include an inline comment documenting the rollback SQL needed if the deploy is reverted.

### Requirement 10: Dashboard Read-Path Swap

**User Story:** As a dashboard user, I want the trend chart and summary tables to keep working continuously throughout the rollout, so that I don't see a blank chart for any window of time.

#### Acceptance Criteria

1. THE Trend_Chart SHALL group `topic_rankings` rows by `canonical_topic_key` (replacing the prior grouping by `topic_label`).
2. THE Trend_Chart legend label for each line SHALL be resolved from `topic_canonicals.canonical_title_zh` when `i18n.language === 'zh'` AND from `topic_canonicals.canonical_title_en` when `i18n.language === 'en'`.
3. WHEN `topic_canonicals.canonical_title_en` IS NULL during an English render, THE Trend_Chart SHALL fall back to `canonical_title_zh` AND render a `(Chinese original)` indicator inline with the legend label.
4. THE dashboard summary tables (Module1 / Module2) SHALL render the new Category_Column with header `"类别"` (zh) / `"Category"` (en) immediately to the right of the existing Topic_Column.
5. THE Category_Column SHALL render the resolved `canonical_title_zh` / `canonical_title_en` (with the same NULL fallback as Acceptance Criterion 3) for any row whose `canonical_topic_key` is non-NULL.
6. WHEN a topic is dropped (no `topic_rankings` row exists) but the underlying `reports.content` still mentions it, THE summary tables SHALL render `"—"` in the Category_Column with a `title` attribute carrying `drop_reason` so hovering surfaces the reason.
7. THE report-detail page (`/reports/[id]`) module tables SHALL render the same Category_Column with the same content rules as Acceptance Criteria 4–6.
8. THE dashboard's read-path swap commit SHALL handle the transition window (rows that already have `canonical_topic_key` AND rows that still only have `topic_label`) by preferring `canonical_topic_key` when present, falling back to grouping by `topic_label` for any null-key rows — once Requirement 9 step (d) backfill completes, this fallback path SHALL be removable in step (f).

### Requirement 11: Telemetry on the Publish Path

**User Story:** As an operator, I want the publish path's canonicalization step to log loudly on every failure, so that broken publishes stop being silent like the previous ad-hoc path was.

#### Acceptance Criteria

1. WHEN the Weekly_Publish_Pipeline begins canonicalization for a report, THE pipeline SHALL log a single `console.log` line containing the report id, domain id, prompt template id, AND the count of scanned topics fed into the engine.
2. WHEN the Canonicalization_Engine LLM call returns a non-2xx HTTP status, THE Weekly_Publish_Pipeline SHALL log a `console.error` line containing the report id, the HTTP status code, AND the response body truncated to 500 characters. THE log line SHALL be emitted as soon as the failure is observed; subsequent independent steps in the publish path (e.g. report-translate enqueue) SHALL continue to execute, with each independent step logging its own outcome — a single canonicalize failure SHALL NOT cascade-suppress later log lines from unrelated work.
3. WHEN the Canonicalization_Engine response fails Zod validation, THE Weekly_Publish_Pipeline SHALL log a `console.error` line containing the report id AND the Zod error path / message.
4. WHEN the Weekly_Publish_Pipeline drops topics due to bucket gating, THE pipeline SHALL log one `console.warn` line summarising the drop count per module AND a `console.info` line per dropped topic with the topic identity AND `drop_reason`.
5. WHEN the Weekly_Publish_Pipeline successfully persists `topic_rankings`, THE pipeline SHALL log a single `console.log` line containing `inserted=N`, `dropped=M`, `newCanonicals=K`, `reusedCanonicals=R`, AND the report id.
6. THE Weekly_Publish_Pipeline SHALL NOT swallow canonicalization errors silently — every error path SHALL terminate at one of the log lines above, never at an empty `catch {}` block.

### Requirement 12: History Rewrite for W17 and W19

**User Story:** As a dashboard user, I want the existing W17 and W19 trend rows re-extracted through the new shared flow, so that my legend stops mixing English `topic_label` strings with the new Chinese canonical titles after the swap.

#### Acceptance Criteria

1. THE System SHALL provide a one-shot script (e.g. `npm run backfill:topic-rankings -- --report b0c05dae-… --report f8b2ea58-…`) that, for each given report id, deletes the existing `topic_rankings` rows for that `report_id` AND re-runs the new shared canonicalization flow against `report.content.modules[*].topTopics`.
2. THE script SHALL leave the two affected reports (`b0c05dae-0161-4af3-a8d7-53a3c18baf2c` W17 AND `f8b2ea58-2d91-4b0d-87fc-7cdd8c309937` W19) in `status='published'` — the script SHALL NOT modify `reports.status`, `reports.content`, OR `reports.published_at`.
3. AFTER the script completes successfully, THE manual verification SHALL be the SQL `SELECT report_id, count(*) AS row_count, count(canonical_topic_key) AS keyed_count FROM topic_rankings WHERE report_id IN ('b0c05dae-0161-4af3-a8d7-53a3c18baf2c', 'f8b2ea58-2d91-4b0d-87fc-7cdd8c309937') GROUP BY report_id;` — both reports SHALL show `row_count = keyed_count` (every row carries a non-NULL `canonical_topic_key`) AND row_count SHALL be > 0.
4. AFTER the script completes successfully, THE manual verification SHALL be the SQL `SELECT count(*) FROM topic_canonicals WHERE domain_id = '37849348-6d81-4834-a7cc-8b828ecf7d4c' AND origin = 'weekly_report';` — the result SHALL be ≥ 1 (at least one weekly-origin canonical exists for the Account Health domain).
5. THE script SHALL be re-runnable safely: a second run SHALL produce the same `topic_rankings` row shape AND SHALL NOT create duplicate `topic_canonicals` rows (the existing UNIQUE constraint plus `ON CONFLICT DO NOTHING` insert pattern enforces this).
6. IF the W17 backfill resolves a topic to a `canonical_topic_key` AND the W19 backfill independently resolves a different topic to the same key, THEN both reports' `topic_rankings` rows SHALL link to that same canonical row — the cross-week join works as soon as the backfill completes.

### Requirement 13: Failure Modes — Canonicalize Step

**User Story:** As an operator, I want explicit, named failure modes when canonicalization breaks, so that I can diagnose from a Vercel log line without paging the developer.

#### Acceptance Criteria

1. IF the Canonicalization_Engine LLM call returns HTTP 402 (or the equivalent provider-specific "credits exhausted" status), THEN THE Weekly_Publish_Pipeline SHALL terminate the canonicalization step with `failure_reason` containing the literal phrase `"weekly canonicalize: provider credits exhausted"` AND log the provider name in the same log line.
2. IF the Canonicalization_Engine LLM call returns HTTP 5xx OR times out, THEN THE Weekly_Publish_Pipeline SHALL retry up to 2 times with exponential backoff (500ms, 1000ms) before terminating with `failure_reason` containing `"weekly canonicalize: provider unreachable"`.
3. IF the Canonicalization_Engine response body fails Zod validation **AND** retries have been exhausted, THEN THE Weekly_Publish_Pipeline SHALL terminate with `failure_reason` containing `"weekly canonicalize: malformed response"` AND the truncated raw body (≤ 500 chars) SHALL be in the log line. (A single Zod failure with retries still available SHALL NOT terminate the step — it triggers the retry path of Acceptance Criterion 2.)
4. IF the API key required by the Weekly_Publish_Pipeline's chosen provider is missing or empty at publish time (today: `OPENROUTER_API_KEY`; the design-time choice of provider is captured in design.md, not this requirements doc), THEN THE Weekly_Publish_Pipeline SHALL fail fast with `failure_reason` containing `"weekly canonicalize: provider API key missing"` AND the missing env var name BEFORE any LLM call is attempted.
5. WHEN any canonicalization failure occurs, THE Weekly_Publish_Pipeline SHALL still allow `reports.status` to remain `'published'` (per Requirement 7.3); only `topic_rankings` is left empty for that publish, AND the existing publish-route behaviour of returning HTTP 200 to the admin SHALL be preserved. WHEN canonicalization succeeds, THESE failure-mode constraints SHALL NOT be applied — `topic_rankings` is populated normally and the success log line of Requirement 11.5 fires instead of any failure log.

### Requirement 14: Failure Modes — FK Violation on Topic Rankings Insert

**User Story:** As a developer, I want a deterministic outcome when the engine proposes a `canonical_topic_key` for a row that wasn't actually inserted into `topic_canonicals`, so that I never see a half-persisted publish that breaks the dashboard's FK-protected join.

#### Acceptance Criteria

1. WHEN the Weekly_Publish_Pipeline persists `topic_rankings` rows, THE pipeline SHALL persist all `topic_canonicals` upserts BEFORE persisting any `topic_rankings` insert that references those keys, in the same publish request.
2. IF a `topic_rankings` insert nonetheless raises a foreign-key violation (e.g. concurrent process pruned a canonical via a future feature), THEN THE Weekly_Publish_Pipeline SHALL log a `console.error` containing the offending `(domain_id, canonical_topic_key)` pair AND SHALL retry the canonicalize → re-insert sequence exactly once before terminating with `failure_reason` containing `"weekly canonicalize: FK violation on insert"`.
3. THE Weekly_Publish_Pipeline SHALL wrap the canonical-upsert + topic-rankings-insert sequence in a single Supabase transaction (or equivalent server-side function such as a PL/pgSQL RPC modeled on `persist_daily_alert`) so that a partial failure leaves no orphan rows.

### Requirement 15: Concurrency Between Two Weekly Publishes

**User Story:** As an operator, I want two concurrent publishes (rare but possible if an admin double-clicks "Publish") to converge on consistent canonical state, so that the dictionary doesn't fork.

#### Acceptance Criteria

1. WHEN two Weekly_Publish_Pipeline executions run concurrently for the same `report_id`, THE pipeline SHALL rely on the existing `(domain_id, canonical_topic_key)` UNIQUE constraint to deduplicate canonical inserts; the second run's `INSERT ... ON CONFLICT DO NOTHING` SHALL no-op cleanly.
2. WHEN two Weekly_Publish_Pipeline executions run concurrently for the same `report_id`, THE pipeline SHALL delete-then-insert `topic_rankings` rows per Requirement 7.4 — the latest-completed run wins, AND the dashboard SHALL never see partial rows from both runs because each run's delete-then-insert pair runs inside one transaction. IF the transaction fails partway through (DB error, connection loss, deadlock), THEN THE pipeline SHALL roll back the entire transaction, leave the previous `topic_rankings` rows untouched, AND surface the failure per Requirement 11.6 — manual re-publish is the recovery path.
3. WHEN two Weekly_Publish_Pipeline executions run concurrently for two **different** `report_id`s in the same domain that both propose the same brand-new `canonical_topic_key`, THE second pipeline SHALL detect via `RETURNING canonical_topic_key INTO inserted_key` (or equivalent) that its insert no-opped AND SHALL re-fetch the canonical row, treating the result as a "reuse" branch with `is_new_canonical=false` (per Requirement 6.3).

### Requirement 16: Translation Fan-Out for Weekly-Minted Canonicals

**User Story:** As an English-speaking dashboard user, I want canonical titles produced by weekly publish to translate to English asynchronously, so that the trend chart legend is bilingual without me waiting on it.

#### Acceptance Criteria

1. WHEN the Weekly_Publish_Pipeline persists a brand-new `topic_canonicals` row with `origin='weekly_report'`, THE pipeline SHALL enqueue exactly one Inngest event targeting the existing `topic_canonicals` translate function with the new canonical's `(domain_id, canonical_topic_key)` payload. The Daily_Alert_Pipeline's translate-enqueue behaviour for `origin='daily_alert'` rows is governed by its own spec and SHALL NOT be modified by this requirements doc — only weekly-minted canonicals are enqueued from the weekly path.
2. THE translate function SHALL populate `canonical_title_en` AND `canonical_description_en` from the corresponding `_zh` source-of-truth fields using the same translation infrastructure today used for daily-minted canonicals (per the Daily_Alert_Pipeline spec, Requirement 10).
3. THE Weekly_Publish_Pipeline SHALL NOT enqueue translation events for canonical rows that are reused (`origin` was already `'daily_alert'` or `'weekly_report'`, `_en` fields already populated).
4. IF the translation event enqueue fails (Inngest down), THEN THE Weekly_Publish_Pipeline SHALL log a `console.warn` line containing the canonical key AND SHALL NOT abort the publish — the canonical row remains live with Chinese-only content, and the translate Inngest path is the recovery surface.
5. WHEN the dashboard renders Category_Column or Trend_Chart legend for a weekly canonical whose `canonical_title_en IS NULL`, THE bilingual fallback per Requirement 10.3 SHALL apply — Chinese title plus `(Chinese original)` indicator.

### Requirement 17: UI Contract for the New `"类别 / Category"` Column

**User Story:** As a dashboard user, I want the new column to feel like a native part of every existing topic table, so that I don't have to learn a new visual pattern just to read canonical labels.

#### Acceptance Criteria

1. THE Category_Column SHALL appear in: (a) dashboard Module1 summary table, (b) dashboard Module2 summary table, (c) `/reports/[id]` page module tables (every module rendered by `ReportRenderer`). THE column SHALL render in all three locations unconditionally, even on a brand-new domain where zero rows yet have a `canonical_topic_key` — empty cells SHALL render as `"—"` per Acceptance Criterion 4(c) rather than the column being hidden.
2. THE Category_Column SHALL be positioned immediately to the right of the existing Topic_Column in every table listed in Acceptance Criterion 1.
3. THE Category_Column header SHALL render `"类别"` when `i18n.language === 'zh'` AND `"Category"` when `i18n.language === 'en'`.
4. THE Category_Column cell content SHALL be one of three exhaustive cases: (a) the resolved canonical title (per Requirement 10.5) when the underlying topic has a non-NULL `canonical_topic_key`; (b) `"—"` with a `title` HTML attribute carrying `drop_reason` when the topic was dropped; (c) `"—"` with no tooltip when the topic predates this feature and has neither a `canonical_topic_key` nor a stored `drop_reason` (transitional state during the rollout window). THE renderer SHALL select case (a)/(b)/(c) by inspecting only the persisted row state — `canonical_topic_key` non-null → case (a), `drop_reason` non-null → case (b), otherwise → case (c). Inconsistencies between data layers (e.g. a row that has both a `canonical_topic_key` and a stored `drop_reason`) SHALL be resolved by giving case (a) priority — the canonical assignment wins over the drop reason.
5. THE Category_Column SHALL inherit the existing table's text styling — `text-sm`, `text-foreground` for resolved titles, `text-foreground-muted` for `"—"` placeholders.
6. THE Category_Column SHALL NOT introduce a new color, badge, or icon vocabulary; the design system's existing tokens (per `.kiro/steering/ui-design-system.md`) are sufficient.
7. THE Category_Column SHALL NOT be clickable in V1 — drilldown to the canonical detail or filter-by-canonical is out of scope.

### Requirement 18: Other Domains Behaviour

**User Story:** As a future domain owner, I want a new domain's weekly publishes to start with a clean slate for canonicals, so that adding a new domain doesn't accidentally borrow the Account Health dictionary.

#### Acceptance Criteria

1. THE per-domain `(domain_id, canonical_topic_key)` UNIQUE constraint SHALL ensure that a new domain's `topic_canonicals` table is empty until that domain runs its first daily or weekly publish.
2. WHEN the first weekly publish for a new domain runs, THE Canonicalization_Engine's `existing_canonicals_json` payload SHALL be the empty list `[]`, AND every topic that survives the bucket gate SHALL receive `is_new_canonical=true`.
3. THE shared `daily_canonicalization_prompt` SHALL operate correctly on a fresh domain — the prompt body SHALL NOT assume any seeded canonicals exist.
4. THE System SHALL NOT seed `topic_canonicals` rows for any new domain — the dictionary is built up organically by daily and weekly runs.

## Cross-Pipeline Correctness Properties (for Property-Based Testing)

The following properties are candidates for property-based tests. Each tests a single behavioural invariant that is directly testable on YOUR code (not on AWS / Inngest / external services), with bounded cost — these are the cases where 100 generated iterations find more bugs than 2-3 hand-picked examples.

### Cross-pipeline convergence

1. **Same key for semantically-identical topics across pipelines** — for any pair `(daily_topic_text, weekly_topic_text)` where the two strings describe the same problem class in the same sub-area (driven by a generator that perturbs phrasing while preserving the slug-determining keywords), running the shared Canonicalization_Engine on each SHALL produce the same `canonical_topic_key`. *(Validates Req 1.x, 2.x — tested with a stubbed engine that resolves keywords → slug deterministically; 100 paraphrase variants per slug.)*

2. **`origin` doesn't leak into matching** — for any topic, the Canonicalization_Engine's resolution to an existing canonical SHALL be independent of that canonical's `origin` value. Generating the same input against a canonical row first stamped `origin='daily_alert'` and a duplicate test fixture stamped `origin='weekly_report'` SHALL produce identical key resolution. *(Validates Req 2.1.)*

3. **Reuse over creation** — when an existing canonical's `category_slug` + `secondary_axis_*` matches a topic's resolution, the pipeline SHALL reuse it rather than minting a new key with a near-identical slug (e.g. `account-health-rules` vs `account-health-score-rules`). Generated paraphrases SHALL not produce >1 canonical for the same underlying class. *(Validates Req 2.2, 5.x.)*

### Schema and data shape

4. **Canonical key format** — every persisted `topic_canonicals.canonical_topic_key` (regardless of `origin`) SHALL match `^[a-z0-9-]+(::[A-Za-z0-9-]+)?$`. *(Validates Req 5.5.)*

5. **Axis consistency** — for every persisted `topic_canonicals` row, `(secondary_axis_type IS NULL) ↔ (secondary_axis_value IS NULL)`. *(Validates Req 5.2 and the existing CHECK.)*

6. **`topic_rankings.canonical_topic_key` non-null after migration** — once Requirement 9 step (g) completes, every persisted `topic_rankings` row SHALL have a non-NULL `canonical_topic_key`. *(Validates Req 8.4.)*

7. **FK integrity** — for every persisted `topic_rankings` row, there SHALL exist a `topic_canonicals` row with matching `(domain_id, canonical_topic_key)`. *(Validates Req 8.2, Req 14.1.)*

8. **Round-trip — extract → persist → read** — for any well-formed `report.content.modules[*].topTopics` array fed into the Weekly_Publish_Pipeline, the resulting set of `topic_rankings` rows when read back and joined to `topic_canonicals` SHALL produce a list of `(rank, canonical_title_zh)` pairs equivalent to the engine's keep-decisions output. Generators perturb topic order, casing, and whitespace; round-trip SHALL be stable. *(Validates Req 4.x, Req 8.x — uses a stubbed engine.)*

### Bucket gating

9. **Drop topics never produce `topic_rankings` rows** — for any Canonicalization_Engine output where some assignments carry `decision='drop'`, the count of `topic_rankings` rows persisted by the Weekly_Publish_Pipeline SHALL equal the count of `decision='keep'` assignments. *(Validates Req 4.2.)*

10. **`bucket` field consistency** — for every assignment with `decision='keep'`, `bucket` SHALL be one of `'account_suspension'` or `'listing_takedown'`; for every assignment with `decision='drop'`, `bucket` SHALL be `null`. *(Validates Req 4.1.)*

11. **`drop_reason` presence** — for every assignment with `decision='drop'`, `drop_reason` SHALL be a non-empty string. *(Validates Req 4.3.)*

### Idempotence and concurrency

12. **Re-publish idempotence** — for any report `R` that has already been published once, running the Weekly_Publish_Pipeline a second time on `R` SHALL produce the same set of `topic_rankings` rows (same set of `canonical_topic_key`s and ranks) given identical engine output, AND SHALL NOT duplicate any `topic_canonicals` rows. *(Validates Req 7.4, Req 6.2.)*

13. **Backfill idempotence** — running the W17/W19 backfill script twice SHALL produce identical `topic_rankings` row content AND SHALL not increase the `topic_canonicals` row count on the second run. *(Validates Req 12.5.)*

14. **Concurrent new-canonical proposal** — for any pair of pipeline runs (daily + weekly, or weekly + weekly) that simultaneously propose the same brand-new `canonical_topic_key`, exactly one `topic_canonicals` row SHALL exist after both runs complete; both runs' downstream rows SHALL link to it. *(Validates Req 6.2, Req 15.1, Req 15.3.)*

### Immutability of `reports.content`

15. **`reports.content` byte-stable across publish** — for any report `R`, the SHA-256 hash of `reports.content` BEFORE the canonicalization step matches the SHA-256 hash AFTER the step (regardless of whether canonicalization succeeded, dropped some topics, or failed entirely). *(Validates Req 7.1, Req 7.2, Req 7.3.)*

16. **`reports.content` byte-stable across re-publish** — running the Weekly_Publish_Pipeline twice on the same `report_id` SHALL leave `reports.content` byte-identical to its pre-first-run value. *(Validates Req 7.1, Req 7.4.)*

### Telemetry

17. **No silent canonicalize failure** — for any simulated canonicalize failure (HTTP 4xx, 5xx, timeout, malformed JSON, FK violation), the Weekly_Publish_Pipeline SHALL emit at least one `console.error` log line referencing the report id. *(Validates Req 11.6.)*

18. **Drop counts logged** — for any publish where ≥ 1 topic is dropped, the Vercel logs for that publish SHALL contain at least one `console.warn` line whose text includes the substring `"dropped"` AND the count of dropped topics. *(Validates Req 11.4.)*

### Translation fan-out

19. **One translate event per new weekly canonical** — for any publish that mints `K` brand-new canonicals, exactly `K` Inngest events SHALL be enqueued targeting the `topic_canonicals` translate function. *(Validates Req 16.1.)*

20. **No translate event for reuse** — for any publish where every topic resolves to a pre-existing canonical, zero Inngest events SHALL be enqueued targeting the translate function. *(Validates Req 16.3.)*

### Bilingual UI

21. **Category column null fallback** — for any dashboard render with `i18n.language === 'en'` AND a `canonical_title_en IS NULL` row, the rendered Category_Column cell SHALL contain the Chinese title AND a `(Chinese original)` indicator. *(Validates Req 10.3, Req 17.x.)*

22. **Category column drop tooltip** — for any rendered row with no `topic_rankings` row but a stored `drop_reason`, the Category_Column cell SHALL render `"—"` AND a `title` attribute equal to `drop_reason`. *(Validates Req 10.6, Req 17.4.)*

## Non-Functional Notes

### Latency budget on the publish path

The publish path today runs report-translate enqueue (cheap) plus the ad-hoc topic-rankings extraction (one OpenRouter LLM call). After this spec, the path runs report-translate enqueue plus the shared Canonicalization_Engine LLM call (continuing to use OpenRouter — provider choice for the weekly path is unchanged) plus zero-or-more Inngest events for translate fan-out. The Vercel serverless time budget on Pro tier (this project) is 60s; the publish path is admin-triggered and not high-frequency, so a 30s additional latency for canonicalization is acceptable per Principle 1 (`time doesn't matter`). The publish HTTP response SHALL still return within Vercel's per-route limit — failure to do so terminates the route, leaves the report `status='published'` (already updated upstream), and leaves `topic_rankings` empty for that publish (recoverable by re-publishing).

### Provider choice — separate from prompt

The "shared canonicalization" in this spec means **shared prompt text and shared response schema**, not a shared LLM wire-level client. Daily uses Z.AI (because it's already coupled to daily-scan's engine_b runtime); Weekly uses OpenRouter (because it's the existing weekly-publish runtime and it's what `extract.ts` already speaks). Both pipelines feed the same `daily_canonicalization_prompt` and parse the same Zod schema. If a future change wants to consolidate providers, that's a separate technical decision; this spec deliberately leaves it untouched to keep the blast radius small.

### `.single()` discipline

The publish path's prompt-template fetch SHALL use `.limit(1)` rather than `.single()` per the workspace steering rule (`.kiro/steering/tech-environment-compatibility.md`), so that a missing prompt row surfaces as Requirement 1.5's named failure rather than a thrown PostgrestError.

### No prompt-engineering hacks

Per Principle 2 (`prompt engineering is the last resort`), this spec deliberately refuses to add a `weekly_canonicalization_prompt`. Stability comes from schema (the `topic_canonicals` UNIQUE constraint, the new composite FK, the widened CHECK), not from prompt instructions. The shared `daily_canonicalization_prompt` is exercised by both pipelines so prompt drift between them is structurally impossible.
