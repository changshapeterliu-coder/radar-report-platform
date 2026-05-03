# Requirements Document

## Introduction

This feature adds a **standalone daily hot-topic alert** to the Radar Report Platform — a lightweight, auto-published product separate from the existing weekly/biweekly Regular Radar Report.

The alert's job is to identify **breaking market-hot topics in the last 24 hours on Chinese seller social media** (小红书 / 抖音 / 知无不言 / 卖家之家 / 微信公众号) so that the CN-seller support team inside Amazon receives **advance warning of topics that are likely to drive a spike in seller escalations** to Amazon. With advance warning, the team can pre-research, align talk tracks, and prepare support channels before the escalation wave arrives.

The daily alert is deliberately **lighter** than the weekly report:
- No 4-module narrative structure — instead, a ranked list of hot topics with evidence links
- **Single engine** (GLM-4.6 via z.ai direct) instead of the weekly's dual-engine cross-validation
- **Auto-published** on completion — no admin draft-review gate — because "early warning" value decays hourly
- Coverage window = **previous calendar day** (00:00 → 23:59 Asia/Shanghai), not the weekly's 7/14-day window
- Separate configuration from the weekly report — **both can be active at the same time for the same domain**

The daily alert is **completely independent of the Hitting News pipeline**. Daily topics live only on the `/alerts` master-detail page; they are never written to the `news` table and never feed into the weekly report's Hitting News module. Visual signaling (a red "new" badge on topics whose canonical category has never appeared in history) and AI-driven canonicalization (same-class topics get a single shared `canonical_description_zh`) happen entirely within the `/alerts` UI.

**Platform-level topic dictionary — an intentional forward hook.** The canonicalization table introduced by this feature is named `topic_canonicals` (not `daily_topic_canonicals`) and is positioned as a **platform-level, cross-product topic dictionary**, even though V1 has only one writer (the daily alert pipeline). A future spec will let the weekly/biweekly report consult this same dictionary when naming its own topics, so that a topic discussed by daily for weeks and then surfaced in a weekly report uses the **same canonical name in both products**. V1 only prepares the table shape and field semantics for that future integration — it does NOT modify weekly prompts, weekly synthesizer logic, or weekly topic naming in any way.

### Scope

**In scope (V1)**
- Daily schedule configuration (Account Health domain only)
- Manual "trigger now" button for daily alerts
- Single-engine GLM-4.6 research using `search_recency_filter: 'oneDay'`
- Auto-publish immediately on successful generation (no draft stage)
- Master-detail topic ledger page at `/alerts`: top half is a 7-day overview table (one row per day, with topic count and a compact topic-name preview); bottom half is a detail pane that renders the selected day's full topics on click (no page navigation)
- **AI-driven topic canonicalization at write time**: every new daily topic is classified by GLM-4.6 against the full history of prior **Topic_Canonical** rows for the domain, producing a `canonical_topic_key`, a shared `canonical_description_zh`, and a `is_new_canonical` flag. Clustering granularity = "problem class + sub-area" (B-level), with an optional second axis (`site` or `category`) added when the topic is obviously site-specific or category-specific. The canonical dictionary is stored in a **platform-level** `topic_canonicals` table that is positioned for future weekly/biweekly integration (V1 writes only from daily)
- **Origin tagging on canonicals**: each `Topic_Canonical` row carries `origin='daily_alert'` in V1, with the column semantics pre-wired to accept future values like `'weekly_report'` when a follow-up spec integrates weekly naming against this dictionary
- **Visual "new" signal** on the `/alerts` page: topics whose `canonical_topic_key` has `first_seen_date = today's coverage_date` render with a red badge; topics whose canonical is reoccurring render with no badge (plain display — many problems are chronic and do not need extra emphasis)
- Failure-time in-app notifications to every `admin` (so a broken pipeline does not go silent)
- Bilingual topic content: Chinese primary + English translated via the existing translate path
- Coexistence with the weekly/biweekly regular-report schedule on the same domain
- "Empty-day" alerts — still published when GLM returns zero qualifying topics, so the team can confirm the pipeline ran

**Out of scope (V1)**
- **Any integration with the `news` table or the Hitting News module** — daily topics are NOT written to `news`, are NOT auto-pushed to Hitting News, have NO "push to Hitting News" button, and do NOT feed the weekly report's Hitting News section. The weekly report's existing Hitting News generation logic is unchanged
- **Weekly/biweekly report integration with `topic_canonicals`** — the weekly pipeline does NOT read from this dictionary in V1, does NOT write to it, and does NOT have its topic naming changed. A follow-up spec ("weekly canonical integration" or equivalent) is expected to add that integration; V1 only leaves the data shape friendly to it (via the `origin` column and a schema that is not daily-alert-specific)
- Cross-day topic merging beyond canonicalization (each day still has its own `Daily_Hot_Topic` rows; canonicalization links them but does not collapse them)
- Admin-editable canonicalization: the `canonical_topic_key`, `canonical_title_zh`, and `canonical_description_zh` are AI-generated and not admin-editable in V1 (the plan is to observe 1–2 weeks of output and then decide whether manual correction is needed)
- Multi-domain scheduling beyond Account Health
- Per-team-member alert subscription/unsubscription preferences
- Publish-time in-app notifications of any kind (team_member or admin) — the `/alerts` page is the sole discovery surface
- Email / IM push
- Dual-engine cross-validation (single-engine by design — see Glossary)
- Admin-editable `search_recency_filter` / `content_size` (hardcoded for V1)
- Admin-editable hot-score threshold for "empty day" vs "topics found" (hardcoded for V1)
- Translation-completeness gating (publish proceeds on Chinese content; English fills in asynchronously)
- Multi-tier novelty badges (e.g. "re-emerging" / "chronic" / "new") — V1 is strictly "new vs not-new"

## Glossary

- **Daily_Hot_Topic_Alert**: A single execution artifact representing one day's hot-topic scan. Contains 0–N Daily_Hot_Topic rows plus alert-level metadata (coverage window, status, run id).
- **Daily_Hot_Topic**: A single topic row inside a Daily_Hot_Topic_Alert. Fields defined in Requirement 5.
- **Daily_Alert_Scheduler**: The Inngest-hosted scheduler that fires the daily alert on cadence, analogous to the existing weekly Scheduler but reading from Daily_Alert_Config.
- **Daily_Alert_Config**: Admin-editable settings that define when and whether the daily alert fires. Stored independently from `schedule_configs` so that daily + weekly can coexist per domain.
- **Daily_Alert_Coverage_Window**: The 24-hour period the alert covers — the previous calendar day from 00:00 to 23:59 Asia/Shanghai, relative to the trigger time.
- **Daily_Alert_Run**: A single execution record of the Daily_Alert_Scheduler, successful or failed, manual or scheduled. Analogous to `scheduled_runs` but stored in its own table.
- **Daily_Research_Engine**: The single-engine research pipeline that calls GLM-4.6 via z.ai direct with `search_recency_filter: 'oneDay'` and returns a list of Daily_Hot_Topic objects. Reuses `zai-client.ts` infrastructure from the existing Research_Engine but has its own stage structure (scan-only, no multi-module deep-dive).
- **Daily_Canonicalization_Engine**: A second, follow-on GLM-4.6 call made after the scan returns topics. Input: the freshly-scanned topics for today + the full history of prior Topic_Canonical rows for this domain. Output: per scanned topic, a `canonical_topic_key` (either matching an existing canonical or a newly minted one) plus `canonical_title_zh` and `canonical_description_zh` values (either inherited from the matched canonical, or freshly generated for a new canonical).
- **Topic_Canonical**: A persistent row in the platform-level `topic_canonicals` table representing one "problem class + sub-area (+ optional site / category)" category across the entire history of a domain. Holds the shared `canonical_description_zh` used for every topic that belongs to it, plus `first_seen_date`, `last_seen_date`, `seen_count`, and an `origin` tag. Created by the Canonicalization Engine the first time a brand-new class is identified; thereafter reused. **Table scope is platform-level, not daily-alert-specific** — the table is positioned for future consumption by the weekly report as well, but V1 has only one writer (the daily alert pipeline).
- **Canonical_Origin**: A short string tag on every Topic_Canonical row identifying which product first produced the canonical. V1 emits only `'daily_alert'`. Reserved future values include `'weekly_report'` (to be written by a later spec that teaches the weekly pipeline to consult and contribute to this dictionary).
- **Canonical_Topic_Key**: A string identifier for a Topic_Canonical. Format: `{category_slug}` when no secondary axis applies, or `{category_slug}::{secondary_axis_value}` when a secondary axis applies. `category_slug` is a short, lowercase, hyphen-separated English slug (e.g. `kyc-verification`, `account-health-score-rules`, `product-compliance`). `secondary_axis_value` is either an Amazon marketplace code (e.g. `BR`, `CA`, `US`) or a product-category slug (e.g. `toys-battery`, `electronics-battery`). The key does NOT encode a weekly-module prefix — the mapping to weekly modules, if any, is a concern for the future weekly-integration spec and is NOT part of the key format in V1.
- **Canonicalization_Granularity**: The level at which the Canonicalization Engine clusters topics. Defined as **"problem class + sub-area"** — two topics share a canonical when they describe the same kind of problem in the same functional sub-area. Examples: (1) "账户健康评分算法更新" and "账户健康评分新阈值引发卖家困惑" share `account-health-score-rules`; (2) "账户健康申诉审理超时" gets a different canonical `account-health-appeal-process` — same domain but different sub-area. A secondary axis is added when the topic is obviously site-specific (e.g. "KYC 巴西站二次验证" → `kyc-verification::BR`) or category-specific (e.g. "玩具锂电池合规" → `product-compliance::toys-battery`).
- **Is_New_Canonical**: A boolean stamped on every Daily_Hot_Topic at write time. `true` when the topic's `canonical_topic_key` was minted during this run (i.e. first time the key appears in the domain's entire history); `false` when the key matched an existing Topic_Canonical.
- **Hot_Score**: An integer 0–100 returned by GLM-4.6 for each topic, representing the engine's own estimate of escalation-likelihood based on discussion volume, spread velocity, and sentiment. Higher = more likely to drive seller escalations.
- **Source_Link**: A `{ title, url, source_label, published_date }` record extracted from GLM's `web_search[]` return array, representing one piece of evidence for a topic.
- **Sample_Quote**: A `{ text, source_label }` verbatim excerpt from a source that shows seller sentiment — `text` is the Chinese excerpt, `source_label` identifies the platform (e.g. `小红书`, `知无不言`) without per-quote URL. The evidence URLs for the topic as a whole live in `source_links[]`. Each topic carries 2–3 Sample_Quotes.
- **Alert_Topic_Name**: A short Chinese topic title (≤ 40 characters) plus its English translation. Bilingual from day one. Topic-specific (per-day); distinct from `canonical_title_zh` which is class-level and shared across days, stored on Topic_Canonical.
- **Empty_Day_Alert**: A Daily_Hot_Topic_Alert with zero Daily_Hot_Topic rows, published with explanatory text so the team can observe the pipeline ran successfully on a quiet day.
- **Admin**: A user with `role='admin'` in the `profiles` table.
- **Team_Member**: A user with `role='team_member'` in the `profiles` table — the CN-seller support team user persona.

## Requirements

### Requirement 1: Daily Schedule Configuration

**User Story:** As an admin, I want to enable and schedule a daily hot-topic alert independently of the weekly report, so that the two products can run side by side on the same domain.

#### Acceptance Criteria

1. THE Daily_Alert_Config SHALL persist the following fields: `enabled` (boolean), `time_of_day` (`HH:MM` 24-hour Asia/Shanghai), `domain_id` (foreign key to domains), `timezone` (fixed to `Asia/Shanghai` for V1).
2. THE Daily_Alert_Config SHALL have exactly one row per domain.
3. THE Daily_Alert_Config SHALL be stored in a table separate from `schedule_configs`, so that a domain can have the weekly regular report scheduled AND the daily alert scheduled concurrently without mutual interference.
4. WHEN an admin submits valid Daily_Alert_Config values, THE System SHALL persist the values and apply them to subsequent Daily_Alert_Scheduler evaluations within 60 seconds.
5. IF `time_of_day` is not a valid `HH:MM` string in the range `00:00` to `23:59`, THEN THE System SHALL reject the submission with a descriptive validation error.
6. WHEN Daily_Alert_Config.enabled is `false`, THE Daily_Alert_Scheduler SHALL NOT fire scheduled Daily_Alert_Runs for that domain.
7. IF a non-admin user attempts to read or modify Daily_Alert_Config, THEN THE System SHALL reject the request with an authorization error.
8. THE Daily_Alert_Config SHALL ship with a default value of `time_of_day='06:00'` and `enabled=false` for the seeded Account Health domain, so admins opt in explicitly.

### Requirement 2: Daily Scheduled Trigger

**User Story:** As an admin, I want the daily alert to fire automatically every morning, so that the CN-seller support team starts their day already briefed on breaking topics.

#### Acceptance Criteria

1. WHEN Daily_Alert_Config.enabled is `true` AND the current Asia/Shanghai wall-clock time matches `time_of_day` (to the minute), THE Daily_Alert_Scheduler SHALL fire exactly one Daily_Alert_Run with `trigger_type='scheduled'`.
2. THE Daily_Alert_Scheduler SHALL execute outside Vercel's serverless execution limit by running as an Inngest function.
3. WHEN the Daily_Alert_Scheduler fires, THE System SHALL compute the Daily_Alert_Coverage_Window as the previous calendar day in Asia/Shanghai: start = `(trigger_date_shanghai - 1 day) 00:00:00+08:00`, end = `(trigger_date_shanghai - 1 day) 23:59:59+08:00`.
4. IF a Daily_Alert_Run is already in `queued` or `running` status for the same `domain_id` AND the same Daily_Alert_Coverage_Window start date, THEN THE System SHALL NOT create a duplicate Daily_Alert_Run.
5. WHEN two or more trigger events arrive for the same `(domain_id, coverage_window_start_date)` within 5 minutes, THE System SHALL accept exactly one and reject the others via a uniqueness constraint or equivalent deduplication key.
6. WHEN a previously-completed Daily_Alert_Run is replayed by the scheduler infrastructure, THE System SHALL NOT create a second Daily_Hot_Topic_Alert for the same Daily_Alert_Coverage_Window.

### Requirement 3: Manual Trigger

**User Story:** As an admin, I want a "trigger daily alert now" button, so that I can regenerate the day's alert on demand after adjusting prompts or to recover from a failed run.

#### Acceptance Criteria

1. WHEN an admin invokes the manual trigger, THE System SHALL create a Daily_Alert_Run with `trigger_type='manual'`.
2. WHEN the manual trigger is invoked, THE System SHALL use the same Daily_Alert_Coverage_Window computation as scheduled runs (previous Asia/Shanghai calendar day relative to the current time).
3. WHERE an admin manually triggers a run, THE System SHALL allow the run to proceed even when Daily_Alert_Config.enabled is `false`.
4. IF a Daily_Alert_Run is already in `queued` or `running` status for the same `(domain_id, coverage_window_start_date)`, THEN THE System SHALL reject the manual trigger with a message indicating a run is already in progress.
5. IF a non-admin user invokes the manual trigger, THEN THE System SHALL reject the request with an authorization error.

### Requirement 4: Single-Engine Research Execution

**User Story:** As an admin, I want the daily alert powered by a single, Chinese-social-media-native engine that returns same-day freshness and ranked hot topics with real source links, so that each topic comes with evidence the support team can follow.

#### Acceptance Criteria

1. WHEN a Daily_Alert_Run enters `running` status, THE Daily_Research_Engine SHALL invoke exactly one GLM-4.6 call via the existing `zai-client.ts` helper, with `search_recency_filter='oneDay'` and `content_size='high'`.
2. THE Daily_Research_Engine SHALL pass the resolved Daily_Alert_Prompt text (with `{coverage_window_start}`, `{coverage_window_end}`, `{domain_name}` placeholders substituted) to the GLM-4.6 call.
3. THE Daily_Research_Engine SHALL use `response_format: { type: 'json_object' }` on the GLM call and validate the returned JSON against a Zod schema defined in code — the schema SHALL be the authoritative source of the Daily_Hot_Topic shape, not the prompt.
4. THE Daily_Research_Engine SHALL extract the top-level `web_search[]` array from the GLM response and expose each entry as a Source_Link (`{ title, url, source_label, published_date }`) available to downstream topic-processing.
5. WHEN the GLM call completes successfully AND returns a valid topic array, THE Daily_Research_Engine SHALL rank topics by `hot_score` descending and take the top N where N is capped at 10.
6. WHEN the GLM call succeeds AND returns an empty topic array, THE Daily_Research_Engine SHALL return an empty topic list, which SHALL be treated as a valid Empty_Day_Alert (not a failure).
7. THE Daily_Research_Engine SHALL NOT invoke Moonshot, Kimi, the synthesizer, or any other engine of the weekly report pipeline.
8. IF GLM returns HTTP 402, THEN THE Daily_Alert_Run SHALL be marked `failed` with `failure_reason` containing the literal phrase `"z.ai credits exhausted"`.
9. IF GLM returns HTTP 5xx or a timeout, THEN THE Daily_Research_Engine SHALL retry up to 2 times with exponential backoff (500ms, 1000ms) before marking the Daily_Alert_Run as `failed`.
10. IF the GLM response fails Zod validation after retries are exhausted, THEN THE Daily_Alert_Run SHALL be marked `failed` with `failure_reason` containing the phrase `"Daily alert: MalformedResponse"` and the raw response truncated to 500 characters SHALL be stored in the run's `raw_output` field for debugging.

### Requirement 5: Daily Hot Topic Schema

**User Story:** As a member of the CN-seller support team, I want each daily topic to come with verbatim seller quotes, direct source links, and a shared class-level description, so that I can read the primary source for myself before preparing support talk tracks AND I can recognize at a glance which topics are variants of the same recurring problem.

#### Acceptance Criteria

1. THE Daily_Hot_Topic SHALL persist the following fields per topic:
   - `topic_name_zh` (required, Chinese, ≤ 40 characters) — the per-day, topic-specific title as written by the scan engine
   - `topic_name_en` (nullable, populated by the translate path)
   - `keywords` (JSONB array of 1–5 Chinese strings)
   - `sample_quotes` (JSONB array of 2–3 objects, each `{ text, source_label }` — `text` is a verbatim Chinese excerpt ≤ 200 characters; `source_label` identifies the platform without a per-quote URL)
   - `source_links` (JSONB array of 3–10 objects, each `{ title, url, source_label, published_date }`, where `url` is the clickable outbound link)
   - `hot_score` (integer 0–100 inclusive)
   - `summary_zh` (required, Chinese, 80–200 characters, one-paragraph narrative as produced by the scan engine for this specific day's framing)
   - `summary_en` (nullable, populated by the translate path)
   - `alert_id` (foreign key to Daily_Hot_Topic_Alert)
   - `rank` (integer 1–10, populated by the engine's ranking)
   - `canonical_topic_key` (required, foreign-key-like reference to Topic_Canonical; populated by the Canonicalization Engine — see Requirement 9)
   - `is_new_canonical` (boolean, required; `true` when `canonical_topic_key` was minted during this run, `false` when it matched an existing canonical)
2. THE Daily_Hot_Topic SHALL NOT carry a `source_url` field inside `sample_quotes[]` — per-quote outbound URLs are intentionally omitted; the topic-level `source_links[]` array is the single authoritative list of evidence URLs for the topic.
3. IF a topic's `hot_score` is outside the range [0, 100], THEN THE System SHALL reject the topic at validation time and the Daily_Alert_Run SHALL record it in the debug output.
4. IF any entry in `source_links[]` has a missing or malformed `url`, THEN THE System SHALL drop that entry at validation time AND log the drop in the Daily_Alert_Run's debug output; a topic with fewer than 3 valid `source_links[]` after drops SHALL be rejected and logged.
5. THE System SHALL NOT require `cross_engine_confirmed`, `voice_volume`, `severity`, `escalation_signal`, or `recommended_prep` fields — the daily alert is intentionally lighter than the weekly report.
6. THE Daily_Hot_Topic SHALL be bilingual-ready: `topic_name_zh` and `summary_zh` are mandatory at creation, and `topic_name_en` and `summary_en` MAY be null at creation time and populated asynchronously by the translate path.

### Requirement 6: Auto-Publish on Success

**User Story:** As a member of the CN-seller support team, I want the daily alert to be live as soon as the scan completes, so that I don't lose hours waiting for admin review on fast-moving topics.

#### Acceptance Criteria

1. WHEN the Daily_Research_Engine returns a valid topic list (including an empty list) AND the Canonicalization Engine has resolved `canonical_topic_key` + `is_new_canonical` for every non-empty topic, THE System SHALL persist the Daily_Hot_Topic_Alert with `status='published'` and `published_at=now()` in a single transaction.
2. THE System SHALL NOT create a `draft` status for daily alerts — there is no admin review gate.
3. WHEN a Daily_Hot_Topic_Alert is persisted with `status='published'`, THE System SHALL in the same transaction persist all its Daily_Hot_Topic rows with `alert_id` set to the new alert's id AND persist any newly-minted Topic_Canonical rows created during the run.
4. IF the persistence transaction fails (database write error), THEN THE Daily_Alert_Run SHALL be marked `failed` with `failure_reason` containing the phrase `"Persistence failed"` and the full engine output SHALL be retained in the run's `raw_output` field for manual recovery.
5. WHEN a Daily_Alert_Run results in an Empty_Day_Alert, THE System SHALL still publish the alert with zero topics and set a human-readable `empty_day_message_zh` field on the alert row such as `"本日无显著热点话题，管线已正常完成扫描。"`.

### Requirement 7: Failure Handling and Admin Notification

**User Story:** As an admin, I want a clear notification and a debugging breadcrumb whenever the daily alert fails, so that I can react fast without checking the dashboard every morning.

#### Acceptance Criteria

1. WHEN a Daily_Alert_Run ends in `failed` status for any reason, THE System SHALL create an in-app notification for every user with `role='admin'`. The notification SHALL include the `failure_reason` text and a link to the Daily_Alert_Run detail page.
2. WHEN a Daily_Alert_Run ends in `failed` status, THE System SHALL NOT create notifications for users with `role='team_member'` — only admins are notified on failure.
3. THE System SHALL NOT create a Daily_Hot_Topic_Alert row (with any topics) when the run fails — failures only create the `failed` Daily_Alert_Run record plus the admin notifications.
4. WHEN the GLM API is unreachable AND retries are exhausted, THE Daily_Alert_Run `failure_reason` SHALL contain the phrase `"GLM network error"` or `"GLM timeout"` as appropriate.
5. THE System SHALL retain the most recent 10 `failed` Daily_Alert_Runs' `raw_output` fields indefinitely; older failed runs' `raw_output` MAY be truncated to 1000 characters to manage storage.

### Requirement 8: Alerts Page — 7-Day Master-Detail Ledger with Novelty Badge

**User Story:** As a member of the CN-seller support team, I want a single page that shows the last 7 days of hot topics at a glance on top and lets me drill into any one day's full details below without navigating away, AND I want topics that represent a brand-new canonical problem to be visually flagged so that I can spot emerging issues at a glance while treating chronic issues with normal emphasis.

#### Acceptance Criteria

1. THE System SHALL provide a page at `/alerts` accessible to any authenticated user (both `admin` and `team_member`).
2. THE `/alerts` page SHALL render in a **master-detail layout**: the upper region is a 7-day overview table, and the lower region is a detail pane that re-renders in place when a table row is selected — no route change, no full page reload.
3. THE overview table SHALL display exactly the last 7 Daily_Alert_Coverage_Window calendar dates (including dates with no Daily_Hot_Topic_Alert row, rendered as "No run"), in reverse chronological order (newest day first), with the following columns:
   - Coverage Date (Asia/Shanghai, `YYYY-MM-DD` plus weekday)
   - Topic Count (integer; `0` for Empty_Day_Alert; `"—"` for a day with no run)
   - Top-Topic Preview (concatenated `topic_name` values for the top 1–3 ranked topics, truncated with an ellipsis if it overflows)
   - Status Chip (`published` | `failed` | `no run`)
4. IN the Top-Topic Preview cell, any topic with `is_new_canonical=true` SHALL render with a red "new" visual marker (e.g. a red dot or a small red `新` / `NEW` chip immediately adjacent to the topic name); topics with `is_new_canonical=false` SHALL render with no extra marker — plain text only.
5. THE overview table SHALL highlight the currently selected row; by default on first render, the newest day's row SHALL be selected AND its detail SHALL be shown in the lower pane.
6. WHEN a user clicks a row in the overview table, THE detail pane SHALL update in place to show that day's Daily_Hot_Topic_Alert contents.
7. THE detail pane SHALL render, per Daily_Hot_Topic, in ascending `rank` order:
   - `rank` and `topic_name` (language-resolved per Acceptance Criterion 11)
   - A red "new" badge directly adjacent to the topic name when `is_new_canonical=true`; no badge when `is_new_canonical=false`
   - `canonical_title_zh` (or `_en` per language) and `canonical_description_zh` (or `_en`), rendered as a single supplementary line labeled something like `"Class / 类别"`. For topics that share a `canonical_topic_key` within the same day, this line SHALL be rendered identically (shared-description invariant)
   - `hot_score`
   - `keywords` (comma-separated inline)
   - `summary`
   - Up to 3 Sample_Quotes as blockquotes — each showing `text` and `source_label` only; no per-quote outbound URL
   - Up to 10 Source_Links, each as a clickable external URL labeled with its `title` and `source_label`
8. WHEN the selected day is an Empty_Day_Alert, THE detail pane SHALL render the `empty_day_message` (in the user's language if translated, Chinese otherwise) and no topic cards.
9. WHEN the selected day has no run at all (no Daily_Hot_Topic_Alert row), THE detail pane SHALL render a placeholder message such as `"No daily hot-topic alert was generated for this day."`, with no topic cards.
10. THE page SHALL provide a "View older days" control that loads the previous 7-day window; navigating older windows SHALL replace the overview table's 7 rows and reset the selection to the newest row in the new window.
11. WHEN a user views the page with `i18n.language === 'en'` AND a topic has `topic_name_en` or `summary_en` populated, THE page SHALL render the English fields; if either is NULL, THE page SHALL fall back to the Chinese field and render a visible `"(Chinese original)"` indicator next to that field. The canonical description has the same fallback rule — English if `canonical_description_en` is populated, otherwise Chinese + `"(Chinese original)"` indicator.
12. THE `/alerts` page SHALL NOT expose any admin-only controls (e.g. retry, re-translate) to users with `role='team_member'`; admin-only controls from Requirement 11 SHALL only render for users with `role='admin'`.

### Requirement 9: Topic Canonicalization (AI Classification at Write Time, Platform-Level Dictionary)

**User Story:** As a member of the CN-seller support team, I want the AI to automatically recognize when today's topic is a variant of a recurring problem and give it a shared class-level description, so that I do not see the same underlying issue described three different ways on three different days and I can trust the "new" badge to mean "this really is new to our history". **As a platform owner**, I want the canonical dictionary stored in a shape that a future weekly-integration spec can consume without reshaping the table, so that the investment compounds instead of fragmenting across products.

#### Acceptance Criteria

1. WHEN the Daily_Research_Engine returns a non-empty topic list for a Daily_Alert_Run, THE System SHALL invoke the Daily_Canonicalization_Engine exactly once per run to classify every scanned topic against the full history of prior Topic_Canonical rows for the same `domain_id`.
2. THE Daily_Canonicalization_Engine SHALL issue one GLM-4.6 call with `response_format: { type: 'json_object' }` whose input includes (a) the freshly-scanned topics with `topic_name_zh`, `summary_zh`, `keywords`; and (b) the full list of existing `Topic_Canonical` rows for the domain with `canonical_topic_key`, `canonical_title_zh`, `canonical_description_zh`, `category_slug`, `secondary_axis_type`, `secondary_axis_value`.
3. FOR each scanned topic, the Canonicalization Engine output SHALL include:
   - `canonical_topic_key` (string — either an exact match of an existing key, or a newly-proposed key in the format defined in the Glossary)
   - `is_new_canonical` (boolean — `true` iff the key is newly proposed)
   - `canonical_title_zh` (string ≤ 30 characters) — only populated when `is_new_canonical=true`; for reused keys the existing canonical's title is inherited
   - `canonical_description_zh` (string 60–160 characters) — only populated when `is_new_canonical=true`; for reused keys the existing canonical's description is inherited
   - `category_slug` (string — lowercase hyphen-separated English slug representing the problem-class + sub-area)
   - `secondary_axis_type` (`'site' | 'category' | null`) — the type of sub-discrimination this canonical uses, if any
   - `secondary_axis_value` (string or null) — e.g. `"BR"`, `"CA"`, `"toys-battery"`, `"electronics-battery"`; null when `secondary_axis_type` is null
4. THE clustering granularity SHALL be "problem class + sub-area" per the Canonicalization_Granularity glossary definition, with the secondary axis applied only when it is **obviously** site-specific (explicit marketplace name in the topic) or category-specific (explicit product category). Topics that mention no specific site or category SHALL have `secondary_axis_type=null`.
5. WHEN the Canonicalization Engine proposes a new `canonical_topic_key`, THE System SHALL persist a new Topic_Canonical row with the engine-supplied `canonical_title_zh`, `canonical_description_zh`, `category_slug`, `secondary_axis_type`, `secondary_axis_value`, `first_seen_date = coverage_window_start_date`, `last_seen_date = coverage_window_start_date`, `seen_count = 1`, AND `origin = 'daily_alert'`.
6. WHEN the Canonicalization Engine returns an existing `canonical_topic_key` for a scanned topic, THE System SHALL NOT mutate the existing Topic_Canonical's `canonical_title_zh`, `canonical_description_zh`, `category_slug`, `secondary_axis_*`, or `origin` fields — only `last_seen_date` SHALL be updated to `coverage_window_start_date` and `seen_count` SHALL be incremented by 1.
7. WHEN two or more scanned topics in the same run are assigned the same `canonical_topic_key`, THE System SHALL increment that canonical's `seen_count` by the number of distinct scanned topics (not the number of source_link rows), AND update `last_seen_date` to the run's `coverage_window_start_date`.
8. THE Canonicalization Engine SHALL be called on every non-empty run — there is no caching or skipping; an Empty_Day_Alert run with zero topics SHALL skip the Canonicalization call entirely.
9. IF the Canonicalization GLM call fails (network error, 5xx, 402, malformed JSON after retries), THEN THE Daily_Alert_Run SHALL be marked `failed` with `failure_reason` containing the phrase `"Canonicalization failed"`, AND NO Daily_Hot_Topic_Alert SHALL be persisted (the scan result is thrown away rather than persisted with missing canonical links).
10. IF the Canonicalization Engine returns a `canonical_topic_key` that does not match the Glossary format regex (`^[a-z0-9-]+(::[A-Z0-9a-z-]+)?$`), THEN THE System SHALL normalize the key (lowercase the primary segment, trim whitespace) OR reject the run with `failure_reason` containing `"Canonicalization: malformed key"` if normalization cannot produce a valid key.
11. THE `topic_canonicals` table SHALL have a UNIQUE constraint on `(domain_id, canonical_topic_key)` so that re-ordering or duplicate proposals from the engine cannot produce duplicate canonical rows.
12. THE Daily_Canonicalization_Engine SHALL be powered by the same `zai-client.ts` helper as the Research Engine, using GLM-4.6 with `search_recency_filter='noLimit'` (classification does not need fresh web search — it reasons over provided lists) and step timeout ≥ 90s.
13. WHEN the Canonicalization Engine's prompt payload containing the full history of canonical rows would exceed a GLM-4.6 context limit (operationally ≥ 500 existing canonicals for a domain), THE System SHALL still attempt the call — degradation handling in that scenario is out of scope for V1 and will be revisited when it becomes a measured problem.
14. THE `topic_canonicals` table SHALL be named **platform-level, not daily-alert-specific** (i.e. the table name is `topic_canonicals`, not `daily_topic_canonicals`), AND SHALL carry an `origin` column (VARCHAR, NOT NULL, default `'daily_alert'`) whose permitted values in V1 are exactly `{'daily_alert'}` but whose column-level comment SHALL document `'weekly_report'` as a reserved future value to be enabled by a subsequent spec.
15. THE `topic_canonicals` table schema SHALL NOT contain any column whose name or semantics assume a daily-only producer (e.g. no `daily_alert_id`, no `first_daily_run_id`); references from Daily_Hot_Topic to Topic_Canonical SHALL be by the `(domain_id, canonical_topic_key)` tuple, not via a foreign key that assumes daily-only authorship.

### Requirement 10: Bilingual Content Path

**User Story:** As an English-speaking user of the platform, I want daily alert topics AND their shared canonical class descriptions translated to English, so that I'm not blocked from using the product because of language.

#### Acceptance Criteria

1. THE Daily_Hot_Topic SHALL store `topic_name_zh` and `summary_zh` as the Chinese source-of-truth fields, and `topic_name_en` and `summary_en` as the English translated fields.
2. THE Topic_Canonical SHALL store `canonical_title_zh` and `canonical_description_zh` as the Chinese source-of-truth fields, and `canonical_title_en` and `canonical_description_en` as the English translated fields.
3. WHEN a Daily_Hot_Topic is persisted, THE System SHALL enqueue an asynchronous translation job that populates `topic_name_en` and `summary_en` from the Chinese fields via the existing translation infrastructure (`/api/ai/translate-report` or equivalent).
4. WHEN a brand-new Topic_Canonical row is persisted, THE System SHALL enqueue a separate asynchronous translation job that populates `canonical_title_en` and `canonical_description_en` from the Chinese source fields; this job SHALL NOT be re-enqueued for canonical rows that already have populated `_en` fields.
5. IF an asynchronous translation job fails, THEN the affected row SHALL remain live with Chinese-only content, and the `/alerts` page SHALL render the fallback indicator per Requirement 8.11.
6. WHEN an admin views a Daily_Hot_Topic in the `/alerts` page, THE UI SHALL show a "re-translate topic" action that re-enqueues the translation job for that specific topic; AND a separate "re-translate class" action that re-enqueues the translation job for the topic's Topic_Canonical row.

### Requirement 11: Daily Alert Run History Page

**User Story:** As an admin, I want a page showing every past daily alert run with its outcome, so that I can audit the scheduler and diagnose problems across multiple days at once.

#### Acceptance Criteria

1. THE System SHALL provide a page at `/admin/daily-alert-runs` listing Daily_Alert_Runs in reverse chronological order.
2. THE `/admin/daily-alert-runs` page SHALL display these columns per row: Run ID (short, clickable), Triggered At (Asia/Shanghai timestamp), Trigger Type (`scheduled` | `manual`), Status (`queued` | `running` | `succeeded` | `failed`), Coverage Date (`YYYY-MM-DD`), Topic Count (integer or `"—"` if failed), New-Canonical Count (integer count of topics with `is_new_canonical=true` in the resulting alert, or `"—"` if failed), Alert Link (if succeeded), Failure Reason (if failed), Actions (Retry, View Raw Output).
3. THE `/admin/daily-alert-runs` page SHALL paginate at 20 rows per page.
4. WHEN an admin clicks "Retry" on a `failed` Daily_Alert_Run, THE System SHALL create a new Daily_Alert_Run with `trigger_type='manual'` using the original Daily_Alert_Coverage_Window.
5. WHEN an admin clicks "View Raw Output" on a Daily_Alert_Run, THE System SHALL display the run's `raw_output` (scan engine JSON response + canonicalization engine JSON response + any validation errors) in a modal or detail pane.
6. IF a non-admin user attempts to access `/admin/daily-alert-runs`, THEN THE System SHALL reject the request with an authorization error.

### Requirement 12: Admin-Editable Prompts

**User Story:** As an admin, I want to edit both the daily research prompt and the canonicalization prompt, so that I can tune focus (categories, granularity rules, evidence requirements) over time without engineering involvement.

#### Acceptance Criteria

1. THE System SHALL persist two editable prompts per domain: a `daily_scan_prompt` (used by the Research Engine) and a `daily_canonicalization_prompt` (used by the Canonicalization Engine).
2. THE System SHALL ship with a non-empty default value for BOTH prompts, seeded via migration.
3. WHEN an admin submits an updated `daily_scan_prompt`, THE System SHALL persist the new text and use it for all subsequent Daily_Alert_Runs.
4. WHEN an admin submits an updated `daily_canonicalization_prompt`, THE System SHALL persist the new text and use it for all subsequent Canonicalization invocations.
5. IF the `daily_scan_prompt` does not contain both `{coverage_window_start}` AND `{coverage_window_end}` placeholders, THEN THE System SHALL reject the save with a validation error naming the missing placeholders.
6. IF the `daily_canonicalization_prompt` does not contain both `{scanned_topics_json}` AND `{existing_canonicals_json}` placeholders, THEN THE System SHALL reject the save with a validation error naming the missing placeholders.
7. WHEN an admin clicks "Reset to default" on either prompt, THE System SHALL replace that prompt's current text with its shipped default value.
8. IF a non-admin user attempts to read or modify either prompt, THEN THE System SHALL reject the request with an authorization error.
9. THE two daily-alert prompts SHALL be stored separately from the existing weekly prompt templates (`gemini_prompt`, `kimi_prompt`, `synthesizer_prompt`) — either as new `prompt_type` values on the existing `prompt_templates` table (if the CHECK constraint is loosened) or as rows in a dedicated small table.

### Requirement 13: Non-Functional — Execution Environment

**User Story:** As a platform operator, I want the daily alert pipeline to run outside Vercel's serverless time limit, so that GLM calls with long cross-border latency don't fail due to platform constraints.

#### Acceptance Criteria

1. THE Daily_Research_Engine AND the Daily_Canonicalization_Engine SHALL both execute as Inngest function steps, not inside Vercel route handlers.
2. THE Vercel-hosted endpoints related to the daily alert SHALL only enqueue Inngest events, read/write config, read results, or receive Inngest webhook callbacks — no synchronous GLM execution inside a route handler.
3. THE Research Engine step timeout SHALL be set to at least 240s (GLM calls with `content_size='high'` on a one-day recency window have been observed to take 60–180s).
4. THE Canonicalization Engine step timeout SHALL be set to at least 90s.

### Requirement 14: Non-Functional — Secret Privacy

**User Story:** As a security-conscious operator, I want the GLM API key kept server-side, so that it is never exposed to the client or to non-admin users.

#### Acceptance Criteria

1. THE System SHALL NOT expose the GLM API key (`ZAI_API_KEY`) via any client-visible variable, response body, or admin-facing UI.
2. THE Daily_Research_Engine AND the Daily_Canonicalization_Engine SHALL fail fast at the start of a run if `ZAI_API_KEY` is missing or empty, marking the Daily_Alert_Run as `failed` with `failure_reason` containing the literal phrase `"ZAI_API_KEY missing"`.

### Requirement 15: Non-Functional — Timezone Correctness

**User Story:** As a China-based admin, I want the daily alert to cover the Chinese calendar day, so that topics and reports align with the working day my team operates in.

#### Acceptance Criteria

1. THE Daily_Alert_Scheduler SHALL interpret `time_of_day` in Asia/Shanghai regardless of the host's timezone.
2. THE Daily_Alert_Coverage_Window SHALL be computed using Asia/Shanghai calendar-day boundaries, not UTC boundaries.
3. THE Topic_Canonical `first_seen_date` AND `last_seen_date` values SHALL also be Asia/Shanghai calendar dates.
4. THE `/alerts` page, `/admin/daily-alert-runs` page, and all notification timestamps SHALL display times in Asia/Shanghai with an explicit timezone indicator.

### Requirement 16: Non-Functional — Coexistence with Weekly Report and Hitting News

**User Story:** As an admin, I want the daily alert to coexist cleanly with the weekly regular report AND the existing Hitting News pipeline, so that introducing the daily alert changes nothing about the weekly report's behavior and nothing about how Hitting News is populated.

#### Acceptance Criteria

1. THE Daily_Alert_Config table AND the existing `schedule_configs` table SHALL both permit a row for the same `domain_id` simultaneously, with independent `enabled` flags.
2. THE Daily_Alert_Run table AND the existing `scheduled_runs` table SHALL be independent — running or failing one SHALL NOT affect the other.
3. THE two daily-alert prompts AND the three existing weekly prompt templates (`gemini_prompt`, `kimi_prompt`, `synthesizer_prompt`) SHALL be editable independently — saving one SHALL NOT modify the others.
4. WHEN the weekly regular-report Scheduler fires at the same minute as the Daily_Alert_Scheduler, THE two SHALL run in parallel as independent Inngest function executions without interference.
5. THE daily alert UI surfaces (`/alerts`, `/admin/daily-alert-runs`, `/admin/daily-alert-settings`) SHALL be separate routes from the weekly report's existing routes (`/reports`, `/admin/scheduled-runs`, `/admin/schedule-settings`).
6. THE daily alert pipeline SHALL NOT write to the `news` table under any circumstance (scheduled, manual, retry, or replay). Hitting News rows in `news` SHALL continue to be produced solely by the weekly-report pipeline's existing logic, unchanged by this feature.
7. THE weekly-report Hitting News module SHALL NOT read from the `daily_hot_topics` or `daily_hot_topic_alerts` tables in V1, AND SHALL NOT read from the `topic_canonicals` table in V1 — the two products' data flows are fully disjoint for V1. The `topic_canonicals` table schema is designed to accommodate future weekly integration (Requirement 9.14–9.15) but no such integration is built in V1.

## Correctness Properties (for Property-Based Testing)

The following properties are candidates for property-based tests during implementation. Each property tests a single behavioral invariant and can be driven with generated inputs.

1. **Daily coverage window correctness**: For any trigger time T in Asia/Shanghai, the computed Daily_Alert_Coverage_Window SHALL span `[T_date - 1 day, 00:00, Asia/Shanghai]` through `[T_date - 1 day, 23:59, Asia/Shanghai]` and SHALL always have a duration of exactly 24 hours minus 1 second. *(Validates Req 2.3, 15.2)*
2. **Trigger idempotency**: For any pair of trigger events with the same `(domain_id, coverage_window_start_date)` arriving within 5 minutes, exactly one Daily_Alert_Run row SHALL be created. *(Validates Req 2.4, 2.5, 2.6)*
3. **Disabled schedule produces zero runs**: For any Daily_Alert_Config with `enabled=false` AND any scheduled trigger-time match, the number of Daily_Alert_Runs created with `trigger_type='scheduled'` SHALL be zero. *(Validates Req 1.6)*
4. **Manual trigger works on disabled config**: For any manual trigger invocation on a Daily_Alert_Config with `enabled=false`, exactly one Daily_Alert_Run with `trigger_type='manual'` SHALL be created. *(Validates Req 3.3)*
5. **Hot score range invariant**: For any persisted Daily_Hot_Topic, `hot_score` SHALL be in the closed range [0, 100]; any topic with `hot_score` outside this range SHALL have been rejected at validation time and logged. *(Validates Req 5.3)*
6. **Top-N cap**: For any Daily_Hot_Topic_Alert, the number of persisted Daily_Hot_Topic rows SHALL be ≤ 10. *(Validates Req 4.5)*
7. **Sample-quote shape integrity**: For any persisted Daily_Hot_Topic, every entry in `sample_quotes[]` SHALL have exactly the keys `{ text, source_label }` with non-empty string values, AND SHALL NOT contain a `source_url` key. *(Validates Req 5.1, 5.2)*
8. **Source-links minimum after validation**: For any persisted Daily_Hot_Topic, the length of `source_links[]` SHALL be ≥ 3 AND ≤ 10, AND every entry SHALL have a syntactically valid `url`. *(Validates Req 5.4)*
9. **Schema round-trip**: For any valid GLM JSON response matching the Zod schema, parsing it and then serializing it back into the DB JSONB columns and re-reading it SHALL yield an object functionally equivalent to the original parse. *(Validates Req 4.3, 5.1)*
10. **Auto-publish invariant**: For any Daily_Alert_Run that ends in `succeeded` status, the associated Daily_Hot_Topic_Alert SHALL have `status='published'` AND `published_at IS NOT NULL`; there SHALL be no `draft`-status row for daily alerts. *(Validates Req 6.1, 6.2)*
11. **Empty-day alert shape**: For any Daily_Alert_Run that succeeds with zero topics returned by the engine, the persisted Daily_Hot_Topic_Alert SHALL have `status='published'`, a non-empty `empty_day_message_zh`, and zero linked Daily_Hot_Topic rows. *(Validates Req 4.6, 6.5)*
12. **Failure produces no alert row**: For any Daily_Alert_Run that ends in `failed` status, the number of Daily_Hot_Topic_Alert rows linked to that run SHALL be zero. *(Validates Req 7.3)*
13. **Failure-mode naming — z.ai credits**: For any simulated GLM 402 response on either the Scan or Canonicalization call, the resulting Daily_Alert_Run's `failure_reason` SHALL contain the literal substring `"z.ai credits exhausted"`. *(Validates Req 4.8, 9.9)*
14. **Failure-mode naming — missing key**: For any run started when `ZAI_API_KEY` is missing or empty, the resulting Daily_Alert_Run's `failure_reason` SHALL contain the literal substring `"ZAI_API_KEY missing"`. *(Validates Req 14.2)*
15. **Failure-mode naming — canonicalization failure**: For any simulated failure (5xx, timeout, malformed JSON after retries) of the Canonicalization GLM call, the resulting Daily_Alert_Run's `failure_reason` SHALL contain the literal substring `"Canonicalization failed"`, AND the number of persisted Daily_Hot_Topic_Alert rows linked to that run SHALL be zero. *(Validates Req 9.9)*
16. **No news table writes**: For any Daily_Alert_Run (scheduled, manual, retry, or replay) that completes in any status, the number of rows inserted into the `news` table by the daily-alert pipeline SHALL be exactly zero. *(Validates Req 16.6)*
17. **Zero publish-time notifications**: For any Daily_Hot_Topic_Alert transitioning to `status='published'`, the total number of in-app notifications created by the daily-alert pipeline SHALL be zero for every user role. *(Validates Req 7.1 failure-only scope + implicit scope boundary)*
18. **Admin notification on failure**: For any Daily_Alert_Run transitioning to `failed`, the number of notifications created with recipient `role='admin'` SHALL equal the number of admin users; the number with recipient `role='team_member'` SHALL be zero. *(Validates Req 7.1, 7.2)*
19. **Canonical key format**: For every persisted Topic_Canonical, `canonical_topic_key` SHALL match the regex `^[a-z0-9-]+(::[A-Za-z0-9-]+)?$`. *(Validates Req 9.10, Glossary)*
20. **Canonical key uniqueness per domain**: For any `(domain_id, canonical_topic_key)` pair, the number of rows in `topic_canonicals` SHALL be ≤ 1. *(Validates Req 9.11)*
21. **Shared canonical description invariant**: For any two Daily_Hot_Topic rows `A` and `B` in any day with `A.canonical_topic_key = B.canonical_topic_key`, the resolved `canonical_title_zh` AND `canonical_description_zh` rendered for `A` SHALL be byte-identical to those rendered for `B`. *(Validates Req 8.7, 9.6)*
22. **Cross-day canonical description invariant**: For any two Daily_Hot_Topic rows `A` and `B` on different days with `A.canonical_topic_key = B.canonical_topic_key`, the resolved `canonical_description_zh` rendered for `A` SHALL be byte-identical to that rendered for `B` — the class-level description does not drift across days. *(Validates Req 9.6)*
23. **Novelty flag correctness**: For any Daily_Hot_Topic with `is_new_canonical=true`, the Topic_Canonical row with its `canonical_topic_key` SHALL have `first_seen_date` equal to the parent alert's `coverage_window_start_date`. Conversely, for any Daily_Hot_Topic with `is_new_canonical=false`, the canonical row's `first_seen_date` SHALL be strictly earlier than the parent alert's `coverage_window_start_date`. *(Validates Req 5.1, 9.3, 9.5, 9.6)*
24. **First-ever-topic-for-domain is new**: For the very first Daily_Hot_Topic ever persisted for a given `domain_id` (i.e. when `topic_canonicals` is empty for that domain), the topic's `is_new_canonical` SHALL be `true`. *(Validates Req 9.5 initial-state case)*
25. **Seen-count integrity**: For any Topic_Canonical, `seen_count` SHALL equal the number of distinct Daily_Hot_Topic rows (across all alerts for the same domain) whose `canonical_topic_key` equals this canonical's key. *(Validates Req 9.5, 9.6, 9.7)*
26. **Secondary-axis presence is meaningful**: For any Topic_Canonical where `secondary_axis_type` is `'site'`, the `secondary_axis_value` SHALL match a recognizable marketplace code (e.g. 2-letter ISO country code or a known Amazon marketplace label); where `secondary_axis_type` is `null`, `secondary_axis_value` SHALL also be `null`. *(Validates Req 9.3, 9.4)*
27. **Prompt placeholder enforcement — scan prompt**: For any attempt to save a `daily_scan_prompt` missing either `{coverage_window_start}` or `{coverage_window_end}`, the save SHALL be rejected, AND the persisted value SHALL remain unchanged. *(Validates Req 12.5)*
28. **Prompt placeholder enforcement — canonicalization prompt**: For any attempt to save a `daily_canonicalization_prompt` missing either `{scanned_topics_json}` or `{existing_canonicals_json}`, the save SHALL be rejected, AND the persisted value SHALL remain unchanged. *(Validates Req 12.6)*
29. **Alerts page 7-day window size**: For any `/alerts` page render, the overview table SHALL contain exactly 7 rows, one per calendar date in the window (including days with no run), in strictly reverse chronological order. *(Validates Req 8.3)*
30. **Default-selected row on first render**: For any `/alerts` page's first render, the newest-day row SHALL be selected AND the detail pane SHALL render that day's content (Daily_Hot_Topic_Alert, Empty_Day_Alert message, or "no run" placeholder, whichever applies). *(Validates Req 8.5, 8.8, 8.9)*
31. **Master-detail row switch is in-place**: For any click on a non-selected row in the overview table, the URL pathname SHALL remain `/alerts` (no route change) AND the detail pane SHALL re-render to the clicked day's content. *(Validates Req 8.2, 8.6)*
32. **New-badge correctness in preview and detail**: For any Daily_Hot_Topic rendered on `/alerts`, the red "new" badge SHALL appear both in the overview table's Top-Topic Preview cell (if the topic is among the top 1–3) AND in the detail pane's topic card if and only if `is_new_canonical=true`; for topics with `is_new_canonical=false`, no badge SHALL be present in either location. *(Validates Req 8.4, 8.7)*
33. **Topic ordering within alert**: For any Daily_Hot_Topic_Alert, topics SHALL be renderable in ascending `rank` order (1, 2, 3, …), with `rank` values forming a contiguous sequence starting at 1. *(Validates Req 4.5, 5.1)*
34. **Bilingual fallback rendering — topic**: For any `/alerts` page detail-pane render with `i18n.language='en'` AND a topic whose `topic_name_en IS NULL`, the rendered output SHALL contain the Chinese `topic_name_zh` AND a visible `"(Chinese original)"` indicator. *(Validates Req 8.11)*
35. **Bilingual fallback rendering — canonical**: For any `/alerts` page detail-pane render with `i18n.language='en'` AND a topic whose resolved canonical has `canonical_description_en IS NULL`, the rendered output SHALL contain the Chinese `canonical_description_zh` AND a visible `"(Chinese original)"` indicator. *(Validates Req 8.11, 10.2)*
36. **Team_member sees no admin controls**: For any `/alerts` page render in a session whose user has `role='team_member'`, the DOM SHALL NOT contain admin-only action buttons such as "Retry", "Re-translate topic", or "Re-translate class". *(Validates Req 8.12)*
37. **Timezone-independent schedule firing**: For any host timezone and any Daily_Alert_Config `time_of_day` value, the Daily_Alert_Scheduler SHALL fire when the Asia/Shanghai wall-clock matches `time_of_day`, regardless of the host's local time. *(Validates Req 15.1)*
38. **Coexistence isolation — config**: For any `(domain_id)` with both a Daily_Alert_Config row AND a `schedule_configs` row present, updating one SHALL NOT modify any field of the other. *(Validates Req 16.1, 16.3)*
39. **Coexistence isolation — runs**: For any domain, setting one of the two schedules to `enabled=false` SHALL NOT cancel any in-progress or scheduled runs of the other. *(Validates Req 16.2, 16.4)*
40. **UI route separation**: For any of the three daily-alert UI routes (`/alerts`, `/admin/daily-alert-runs`, `/admin/daily-alert-settings`), the weekly report routes (`/reports`, `/admin/scheduled-runs`, `/admin/schedule-settings`) SHALL remain accessible and functional. *(Validates Req 16.5)*
41. **Weekly Hitting News unaffected**: For any weekly-report generation run that completes after the daily alert feature is deployed, the set of `news` rows produced by the weekly pipeline SHALL be identical in shape and count to what the same run would have produced before the daily feature existed (i.e. no daily-alert code path reads from or writes to the weekly Hitting News generation). *(Validates Req 16.6, 16.7)*
42. **Canonical table is platform-level**: The created DB table SHALL be named `topic_canonicals` (no `daily_` prefix) AND SHALL carry an `origin` column with NOT NULL default `'daily_alert'`; no column in the table SHALL reference daily-run-only identifiers (`daily_alert_id`, `first_daily_run_id`, etc.). *(Validates Req 9.14, 9.15)*
43. **Origin value invariant in V1**: For every row in `topic_canonicals` written by the V1 daily-alert pipeline, `origin` SHALL equal `'daily_alert'`; rows with any other origin value SHALL NOT appear until a subsequent spec enables them. *(Validates Req 9.5)*
44. **Daily topic → canonical reference is by key tuple, not by row id**: The reference from `daily_hot_topics` to `topic_canonicals` SHALL be by the `(domain_id, canonical_topic_key)` tuple (enforced by FK or by app-level invariant); no column on `daily_hot_topics` SHALL carry a direct `topic_canonical_id` foreign-key that would assume daily-only authorship of the canonical row. *(Validates Req 9.15)*
45. **Authorization — config**: For any HTTP request to read or modify Daily_Alert_Config from a non-admin user, the response SHALL be a 401 or 403 authorization error, AND no DB mutation SHALL occur. *(Validates Req 1.7)*
46. **Authorization — manual trigger**: For any manual-trigger HTTP request from a non-admin user, the response SHALL be a 401 or 403 authorization error, AND no Daily_Alert_Run SHALL be created. *(Validates Req 3.5)*
47. **Authorization — prompts**: For any HTTP request to read or modify either `daily_scan_prompt` or `daily_canonicalization_prompt` from a non-admin user, the response SHALL be a 401 or 403 authorization error, AND no DB mutation SHALL occur. *(Validates Req 12.8)*
