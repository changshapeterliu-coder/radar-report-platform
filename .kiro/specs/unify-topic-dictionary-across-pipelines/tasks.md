# Implementation Plan: Unify Topic Dictionary Across Pipelines

## Overview

Convert the design's 7-step rollout (Req 9.1) into incremental coding tasks. Each task references the design's PR mapping (`Rollout and Reversibility` table) and the requirement clauses it covers. Tasks proceed in the strict order migrations → shared code modules → publish route refactor → backfill → dashboard read-path swap → stop dual-write → drop legacy columns, so the dashboard never reads from a half-migrated state. Property tests follow the design's `Testing Strategy` table and sit close to their SUTs. Implementation language is TypeScript (Next.js 16 / Vitest / fast-check) plus PL/pgSQL for migrations and the persist RPC.

## Tasks

- [x] 1. PR-A: Migration 025 — widen `topic_canonicals.origin` CHECK
  - [x] 1.1 Create `supabase/migrations/025_widen_topic_canonicals_origin.sql`
    - Drop existing CHECK constraint (`DROP CONSTRAINT IF EXISTS`), re-add with `CHECK (origin IN ('daily_alert', 'weekly_report'))`
    - Update `COMMENT ON COLUMN topic_canonicals.origin` to remove "reserved future value" wording
    - Include header comment with rollback SQL and Req 9.3 verification query
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 9.1(a), 9.7_

  - [ ]* 1.2 Migration unit test for 025
    - In `src/__tests__/migrations.test.ts`, run migration and assert `pg_get_constraintdef` references both `'daily_alert'` and `'weekly_report'`
    - _Requirements: 3.6, 9.3_

- [x] 2. PR-B: Migration 026 — add `topic_rankings.canonical_topic_key` (nullable) + composite FK + index + persist RPC
  - [x] 2.1 Create `supabase/migrations/026_add_topic_rankings_canonical_topic_key_nullable.sql`
    - `ADD COLUMN canonical_topic_key VARCHAR(120) NULL`
    - `ADD CONSTRAINT topic_rankings_canonical_fk FOREIGN KEY (domain_id, canonical_topic_key) REFERENCES topic_canonicals (domain_id, canonical_topic_key) ON DELETE RESTRICT`
    - `CREATE INDEX idx_topic_rankings_domain_canonical ON topic_rankings (domain_id, canonical_topic_key)`
    - `COMMENT ON COLUMN ...` documenting the rollout window
    - Header comment with rollback SQL + Req 9.4 verification query
    - _Requirements: 8.1, 8.2, 8.7, 9.1(b), 9.7_

  - [x] 2.2 Create `supabase/migrations/026b_persist_weekly_topic_rankings.sql` (`persist_weekly_topic_rankings` PL/pgSQL RPC)
    - Signature `(p_report_id UUID, p_domain_id UUID, p_week_label TEXT, p_topics_by_module JSONB, p_assignments_by_module JSONB, p_existing_canonical_keys TEXT[]) RETURNS JSONB`
    - Body wraps the full sequence in one transaction: validate input shapes, `DELETE FROM topic_rankings WHERE report_id = p_report_id`, per-module loop performing `INSERT INTO topic_canonicals ... ON CONFLICT (domain_id, canonical_topic_key) DO NOTHING RETURNING canonical_topic_key`, append minted keys to `v_new_canonical_keys` only when RETURNING is non-NULL, `UPDATE topic_canonicals SET last_seen_date = today_shanghai(), seen_count = seen_count + reuse_count`, then `INSERT INTO topic_rankings (... canonical_topic_key ...)` for kept assignments
    - Returns `{ inserted, perModule, newCanonicalKeys, reusedCanonicalKeys }`
    - `EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'persist_weekly_topic_rankings failed: %', SQLERRM` — full rollback
    - `GRANT EXECUTE ... TO service_role` only
    - _Requirements: 2.3, 2.4, 6.2, 6.3, 7.4, 14.3, 15.1, 15.2, 15.3_

  - [ ]* 2.3 Migration unit test for 026
    - Assert `is_nullable='YES'` and `data_type='character varying'` on the new column
    - Assert FK + index exist
    - _Requirements: 8.1, 8.2, 9.4_

- [x] 3. Checkpoint — migrations 025 / 026 / 026b deployed and verified
  - Ensure all tests pass, ask the user if questions arise.
  - Inform user to run migrations 025, 026, 026b in Supabase SQL Editor before proceeding.

- [x] 4. PR-C: Shared canonicalization code modules + publish route refactor (dual-write transitional)
  - [x] 4.1 Create `src/lib/topic-rankings/zod-schemas.ts`
    - Pure re-export of `CANONICAL_KEY_REGEX`, `CanonicalizeResponseSchema`, `CanonicalAssignmentSchema`, `ScanTopicSchema`, `normalizeCanonicalKey`, plus the `CanonicalAssignment`, `ScanTopic`, `CanonicalizeResponse` types from `@/lib/daily-alert/zod-schemas`
    - _Requirements: 1.4, 5.5_

  - [x] 4.2 Create `src/lib/topic-rankings/scan.ts` (`buildScannedTopicsFromModule`)
    - Pure function: input `(content: ReportContent, moduleIndex: number)` → `ScanTopic[]` from `content.modules[moduleIndex].topTopics` populating only canonicalize-relevant fields (`topic_name_zh`, `summary_zh`, `keywords`)
    - Returns `[]` for missing module or empty `topTopics`
    - No LLM call, no side effects
    - _Requirements: 1.4_

  - [x] 4.3 Create `src/lib/topic-rankings/canonicalize.ts` (`runWeeklyCanonicalize`)
    - Fail fast with `'weekly canonicalize: provider API key missing OPENROUTER_API_KEY'` when env var empty
    - Use shared `substitute()` from `daily-alert/substitute.ts` with `{scanned_topics_json}`, `{existing_canonicals_json}`, `{domain_name}`
    - POST `https://openrouter.ai/api/v1/chat/completions` with `model: 'openrouter/auto'`, `response_format: { type: 'json_object' }`
    - Map HTTP 402 → `'weekly canonicalize: provider credits exhausted'`; retry HTTP 5xx / timeout 2× with backoff (500ms, 1000ms) → `'weekly canonicalize: provider unreachable'`
    - `CanonicalizeResponseSchema.safeParse` with retries-exhausted → `'weekly canonicalize: malformed response'` (truncate raw to 500 chars)
    - Per-keep assignment: call `normalizeCanonicalKey`; single bad key drops only that topic with `'weekly canonicalize: malformed key'` log warning, continue processing
    - Return `{ ok: true, keptAssignments, droppedAssignments, rawContent }` or `{ ok: false, failureReason, rawOutput }`
    - _Requirements: 1.4, 5.5, 11.2, 11.3, 13.1, 13.2, 13.3, 13.4_

  - [ ]* 4.4 Property test for `normalizeCanonicalKey` shape invariant
    - **Property 4: Canonical key format**
    - **Validates: Requirements 5.5**

  - [ ]* 4.5 Property test for `bucket` field consistency on Zod schema
    - **Property 10: `bucket` field consistency** — keep ↔ bucket ∈ {`account_suspension`, `listing_takedown`}; drop ↔ bucket null
    - **Validates: Requirements 4.1**

  - [ ]* 4.6 Property test for `drop_reason` presence on Zod schema
    - **Property 11: `drop_reason` presence** — drop branch always carries non-empty string
    - **Validates: Requirements 4.3**

  - [x] 4.7 Refactor `src/lib/topic-rankings/persist.ts` to thin RPC wrapper (`persistWeeklyTopicRankings`)
    - Replace `extractAndPersistTopicRankings` body with `supabase.rpc('persist_weekly_topic_rankings', { p_report_id, p_domain_id, p_week_label, p_topics_by_module, p_assignments_by_module, p_existing_canonical_keys })`
    - Throw `Error('weekly canonicalize: persistence failed: <pg_message>')` on RPC error
    - Remove `replaceExisting` parameter, the bootstrapping `existingLabels` logic, the per-module raw-Chinese-label fallback
    - Keep the `topic_label` / `topic_label_zh` write fields on the RPC payload during the dual-write window (PR-C → PR-F)
    - _Requirements: 7.4, 14.3, 15.2_

  - [x] 4.8 Delete `src/lib/topic-rankings/extract.ts`
    - Remove `extractTopicsForModule`, `stabilizeLabelsV4`, `pickFirstArray`, `TopicEntry`. Update any remaining importer to use the shared `CanonicalAssignment` type from `topic-rankings/zod-schemas.ts`
    - _Requirements: 1.2_

  - [x] 4.9 Refactor `src/app/api/reports/[id]/publish/route.ts` to call canonicalize → persist
    - Replace the `extractAndPersistTopicRankings` block with the `runCanonicalizeBlock` shape from design "Error Handling" section
    - Per Req 11 telemetry: emit log lines for `canonicalize starting`, drop summary, drop-per-topic, success summary, every named failure mode
    - Loud `console.error` on every error path; never empty `catch {}`; always return HTTP 200 with `data: report`
    - Update the AI Insight news block's `select('topic_label')` to `select('canonical_topic_key, topic_canonicals!inner(canonical_title_zh, canonical_title_en)')`
    - Translate fan-out: per minted `newCanonicalKey`, send `daily-alert/translate-canonical` Inngest event; on enqueue failure log warn but do NOT abort
    - During dual-write window, the persist call still supplies `topic_label` / `topic_label_zh` for legacy dashboard read compatibility (cleaned up in PR-F)
    - _Requirements: 1.1, 1.3, 1.5, 2.1, 4.1, 4.2, 4.3, 4.5, 6.1, 6.4, 7.1, 7.2, 7.3, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 13.1, 13.2, 13.3, 13.4, 13.5, 14.1, 14.2, 16.1, 16.4_

  - [ ]* 4.10 Property test for drop topics never producing rankings rows
    - **Property 9: Drop topics never produce `topic_rankings` rows**
    - **Validates: Requirements 4.2**

  - [ ]* 4.11 Property test for concurrent new-canonical proposal
    - **Property 14: Concurrent new-canonical proposal** — two parallel persist calls, exactly one `topic_canonicals` row, both runs link
    - **Validates: Requirements 6.2, 15.1, 15.3**

  - [ ]* 4.12 Property test for `reports.content` byte-stability across publish (30 iterations)
    - **Property 15: `reports.content` byte-stable across publish**
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [ ]* 4.13 Property test for `reports.content` byte-stability across re-publish (30 iterations)
    - **Property 16: `reports.content` byte-stable across re-publish**
    - **Validates: Requirements 7.1, 7.4**

  - [ ]* 4.14 Property test for no silent canonicalize failure
    - **Property 17: No silent canonicalize failure** — error injection on HTTP 4xx/5xx/timeout/malformed JSON/FK violation, assert `console.error` spy called ≥ 1× referencing the report id
    - **Validates: Requirements 11.6**

  - [ ]* 4.15 Property test for drop counts logged
    - **Property 18: Drop counts logged** — `console.warn` spy called with `"dropped"` substring + the count
    - **Validates: Requirements 11.4**

  - [ ]* 4.16 Property test for one translate event per new weekly canonical
    - **Property 19: One translate event per new weekly canonical** — exactly K Inngest events for K new canonicals
    - **Validates: Requirements 16.1**

  - [ ]* 4.17 Property test for no translate event when all reuse
    - **Property 20: No translate event for reuse**
    - **Validates: Requirements 16.3**

  - [ ]* 4.18 Property test for cross-pipeline key convergence (uses stubbed engine for both pipelines)
    - **Property 1: Same key for semantically-identical topics across pipelines**
    - **Validates: Requirements 1, 2**

  - [ ]* 4.19 Property test that `origin` doesn't influence engine matching
    - **Property 2: `origin` doesn't leak into matching**
    - **Validates: Requirements 2.1**

  - [ ]* 4.20 Property test for reuse over creation
    - **Property 3: Reuse over creation** — paraphrased topics never mint a near-identical second slug
    - **Validates: Requirements 2.2, 5**

  - [ ]* 4.21 Property test for axis consistency at DB CHECK level
    - **Property 5: Axis consistency** — both null or both non-null
    - **Validates: Requirements 5.2**

  - [ ]* 4.22 Property test for round-trip extract → persist → read
    - **Property 8: Round-trip extract → persist → read** — `(rank, canonical_title_zh)` pairs match engine `keptAssignments`
    - **Validates: Requirements 4, 8**

  - [ ]* 4.23 Property test for re-publish idempotence
    - **Property 12: Re-publish idempotence** — same row set, no `topic_canonicals` duplication
    - **Validates: Requirements 7.4, 6.2**

  - [ ]* 4.24 Integration tests for refactored publish route
    - canonicalize-failure-but-publish-succeeds (HTTP 502 stubbed → response 200, `data: report`, `console.error` called)
    - drop-all-topics-but-publish-succeeds (all `decision='drop'` → response 200, zero `topic_rankings` inserts)
    - brand-new-canonical (one new + zero existing → `INSERT topic_canonicals origin='weekly_report'`, one `inngest.send`)
    - reuse-existing-canonical (pre-seed + `is_new_canonical=false` → no canonical INSERT, zero translate events)
    - _Requirements: 2.2, 4.5, 6.1, 7.3, 13.5, 16.1, 16.3_

- [x] 5. Checkpoint — Ensure all tests pass and the dual-write publish flow is functional
  - Ensure all tests pass, ask the user if questions arise.
  - Inform user that PR-C is deployable and the publish route is now writing both `canonical_topic_key` and the legacy `topic_label` columns.

- [x] 6. PR-D: Refactor backfill script for W17/W19 history rewrite
  - [x] 6.1 Refactor `scripts/backfill-topic-rankings.ts`
    - CLI shape: `npm run backfill:topic-rankings -- --report=<id> --report=<id>`
    - Per `--report`: SELECT report row → DELETE topic_rankings WHERE report_id → load shared canonicalize prompt + existing canonicals → run `runWeeklyCanonicalize` per module → call `persistWeeklyTopicRankings` → enqueue translate fan-out for new canonicals
    - Drop legacy `--force` and `--domain` flags
    - Never modify `reports.status` / `reports.content` / `reports.published_at`
    - Idempotent on re-run by construction (delete-then-insert + `ON CONFLICT DO NOTHING`)
    - _Requirements: 12.1, 12.2, 12.5, 12.6_

  - [ ]* 6.2 Property test for backfill idempotence
    - **Property 13: Backfill idempotence** — second run produces identical row content, dictionary count unchanged
    - **Validates: Requirements 12.5**

- [x] 7. Checkpoint — Run W17/W19 backfill against Account Health domain
  - Ensure all tests pass, ask the user if questions arise.
  - Inform user to run `npm run backfill:topic-rankings -- --report=b0c05dae-0161-4af3-a8d7-53a3c18baf2c --report=f8b2ea58-2d91-4b0d-87fc-7cdd8c309937` and verify with the SQL in Req 12.3 / 12.4 (`row_count = keyed_count > 0`, weekly-origin canonical count ≥ 1) before proceeding.

- [x] 8. PR-E: Dashboard + UI read-path swap to `canonical_topic_key`
  - [x] 8.1 Extend `TopTopicsTable` with `categoryResolution` prop and `CategoryCell` renderer
    - Add `categoryResolution?: Array<CategoryCellState>` prop where `CategoryCellState = { kind: 'canonical'; titleZh; titleEn } | { kind: 'dropped'; dropReason } | { kind: 'unmapped' }`
    - Insert `<th>` with i18n header (`'类别'` zh / `'Category'` en) immediately right of Topic column
    - Per-row `<CategoryCell>`: canonical → resolved title with `(Chinese original)` indicator when `_en` null and lang is en; dropped → `—` with `title=dropReason`; unmapped → `—` no tooltip
    - Use only design-system tokens (`text-foreground`, `text-foreground-muted`, no new colors)
    - Non-clickable
    - _Requirements: 10.3, 10.4, 10.5, 10.6, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7_

  - [x] 8.2 Plumb `categoryResolution` through `src/components/report/ReportRenderer.tsx`
    - Accept optional `categoryResolutionByModule: Record<number, CategoryCellState[]>` prop
    - Pass per-module resolution to each `<TopTopicsTable>`
    - _Requirements: 17.1_

  - [x] 8.3 Update `src/app/(main)/reports/[id]/page.tsx` to fetch canonicals and build `categoryResolution`
    - Add parallel query for `topic_canonicals` filtered by `domain_id`
    - For each module, build `CategoryCellState[]` from `topic_rankings` rows joined to `topic_canonicals` (priority: canonical > dropped > unmapped per Req 17.4)
    - Pass result to `<ReportRenderer categoryResolutionByModule=...>`
    - _Requirements: 10.7, 17.1, 17.4_

  - [x] 8.4 Refactor `src/app/(main)/dashboard/page.tsx` Trend_Chart to group by `canonical_topic_key`
    - Replace `r.topic_label` grouping with `r.canonical_topic_key ?? r.topic_label` (transitional fallback per Req 10.8)
    - Add canonical lookup query in `fetchData` and `resolveLegendLabel(key)` helper applying zh / en / `(Chinese original)` fallback rule
    - Update `COLORS` array to remove `#e74c3c` and align with the design system's chart palette (`#ff9900 → #146eb4 → #374151 → #10b981 → #8b5cf6 → #06b6d4 → #d97706`)
    - _Requirements: 10.1, 10.2, 10.3, 10.8_

  - [x] 8.5 Wire dashboard Module1 / Module2 summary tables to `<TopTopicsTable categoryResolution=...>`
    - Build `categoryResolution[]` for each module from the joined `topic_rankings` + `topic_canonicals` query result
    - _Requirements: 10.4, 10.5, 10.6, 17.1, 17.2_

  - [ ]* 8.6 Property test for Category column null fallback
    - **Property 21: Category column null fallback** — `_en` null + `i18n.language='en'` → renders zh title + `(Chinese original)`
    - **Validates: Requirements 10.3, 17**

  - [ ]* 8.7 Property test for Category column drop tooltip
    - **Property 22: Category column drop tooltip** — `kind: 'dropped'` → `td` content `—`, `title=dropReason`
    - **Validates: Requirements 10.6, 17.4**

- [x] 9. PR-F: Stop dual-writing legacy `topic_label` / `topic_label_zh`
  - [x] 9.1 Remove `topic_label` / `topic_label_zh` writes from `persist_weekly_topic_rankings` RPC and from `persist.ts`
    - Drop both columns from the INSERT statement inside the RPC body
    - Drop the corresponding fields from the TypeScript persist payload
    - _Requirements: 9.1(f)_

  - [x] 9.2 Drop the transitional `?? r.topic_label` fallback from `dashboard/page.tsx` Trend_Chart grouping
    - Use `canonical_topic_key` unconditionally
    - _Requirements: 9.1(f), 10.8_

- [x] 10. PR-G: Migration 027 — drop legacy columns + tighten `canonical_topic_key` to `NOT NULL` + update types
  - [x] 10.1 Create `supabase/migrations/027_drop_topic_rankings_legacy_label_columns.sql`
    - `ALTER TABLE topic_rankings ALTER COLUMN canonical_topic_key SET NOT NULL`
    - `ALTER TABLE topic_rankings DROP COLUMN IF EXISTS topic_label`
    - `ALTER TABLE topic_rankings DROP COLUMN IF EXISTS topic_label_zh`
    - Header comment with pre-condition (Req 9.5 verification: zero null `canonical_topic_key`), Req 9.6 post-verification, and rollback SQL (re-add columns nullable, drop NOT NULL)
    - _Requirements: 8.3, 8.4, 9.1(g), 9.5, 9.6, 9.7_

  - [x] 10.2 Update `src/types/database.ts`
    - Remove `topic_label` and `topic_label_zh` from `topic_rankings` Row / Insert / Update
    - Make `canonical_topic_key: string` required (NOT NULL) on Row and Insert
    - Same commit as the migration deploy
    - _Requirements: 8.6_

  - [ ]* 10.3 Migration unit test for 027
    - Pre-populate every row with a `canonical_topic_key` then run migration; assert `topic_label` and `topic_label_zh` columns no longer exist
    - _Requirements: 9.6_

  - [ ]* 10.4 Property test for `canonical_topic_key` non-null after migration
    - **Property 6: `canonical_topic_key` non-null after migration**
    - **Validates: Requirements 8.4**

  - [ ]* 10.5 Property test for FK integrity (left-join produces zero null right sides)
    - **Property 7: FK integrity**
    - **Validates: Requirements 8.2, 14.1**

- [x] 11. Final checkpoint — verify end-to-end dictionary unification
  - Ensure all tests pass, ask the user if questions arise.
  - Inform user to run migration 027 in Supabase SQL Editor and to verify Req 9.6 (`SELECT column_name FROM information_schema.columns WHERE table_name='topic_rankings' AND column_name IN ('topic_label', 'topic_label_zh')` returns zero rows) before declaring the rollout complete.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP. Core implementation tasks (migrations, code modules, publish route refactor, dashboard swap) are all non-optional.
- The 7-step rollout (Req 9.1) is mapped onto PRs A–G in the design's `Rollout and Reversibility` table; tasks 1, 2, 4, 6, 8, 9, 10 mirror that mapping. Each PR can be reverted independently.
- Migrations 025 / 026 / 026b / 027 carry inline rollback SQL in their header comments per Req 9.7.
- PR-C dual-writes both `canonical_topic_key` and the legacy `topic_label` columns so the dashboard's transitional fallback in PR-E (Req 10.8) keeps it readable mid-rollout.
- Backfill in step 6 / 7 is operational; the SQL verification against `topic_rankings` and `topic_canonicals` is required before PR-E ships.
- Property tests use `fast-check` + Vitest; default 100 iterations except properties 15 / 16 (30 iterations due to per-iter publish-flow cost).
- Provider clients stay per-pipeline: Daily uses Z.AI, Weekly uses OpenRouter. What's shared is the prompt body, the placeholder substituter, the Zod schema, the `topic_canonicals` table, and the translate fan-out event.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "4.1", "4.2"] },
    { "id": 1, "tasks": ["2.2", "2.3", "4.3", "4.4", "4.5", "4.6"] },
    { "id": 2, "tasks": ["4.7", "4.8"] },
    { "id": 3, "tasks": ["4.9"] },
    { "id": 4, "tasks": ["4.10", "4.11", "4.12", "4.13", "4.14", "4.15", "4.16", "4.17", "4.18", "4.19", "4.20", "4.21", "4.22", "4.23", "4.24", "6.1"] },
    { "id": 5, "tasks": ["6.2", "8.1", "8.2"] },
    { "id": 6, "tasks": ["8.3", "8.4"] },
    { "id": 7, "tasks": ["8.5", "8.6", "8.7"] },
    { "id": 8, "tasks": ["9.1", "9.2"] },
    { "id": 9, "tasks": ["10.1", "10.2"] },
    { "id": 10, "tasks": ["10.3", "10.4", "10.5"] }
  ]
}
```
