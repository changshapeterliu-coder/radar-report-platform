# Requirements Document

## Introduction

This feature adds automated, scheduled generation of the weekly Account Health Regular Radar Report. A scheduler (Inngest) triggers a dual-engine AI research pipeline on a configurable cadence, which produces a draft report saved to the existing `reports` table with `status='draft'`. An admin reviews and edits the draft, then publishes it through the existing publish endpoint — the scheduled path does not duplicate translate, topic-extract, or hot-news logic.

The research pipeline is designed as a **reusable research engine module** that is consumed by this scheduled regular-report use case in V1, and is architected so a future topic-specific deep-dive feature can reuse it without modification.

### Scope

**In scope (V1)**
- Admin-managed schedule configuration for Account Health domain only
- Manual "trigger now" button
- Dual-engine parallel research (Gemini Deep Research + Kimi Explore) with channel-specialized prompts
- Cross-validation synthesizer (via OpenRouter) that merges findings and tags confidence
- Draft creation in existing `reports` table
- Skeleton-draft + admin notification on failure
- Admin run-history page at `/admin/scheduled-runs`
- Admin-editable prompt templates (3 prompts: Gemini, Kimi, Synthesizer)

**Out of scope (V1)**
- Topic-specific deep-dive reports (research engine is designed to support this later, but the UI/flow is not built)
- Multi-domain scheduling (only Account Health domain supported)
- Team-wide notifications on draft creation (only admin is notified until publish)
- Translate / topic-extract / hot-news generation (all handled by the existing `/api/reports/[id]/publish` flow)
- Admin-configurable seed keywords or channel whitelists as a separate UI (admin steers research by editing prompt text directly)

## Glossary

- **Scheduler**: Inngest-hosted scheduled function that triggers report generation on cadence
- **Research_Engine**: The reusable module that executes dual-engine parallel research and synthesis. Takes a coverage window + domain + prompts as input, returns a `ReportContent` object. Has no knowledge of scheduling or drafts — pure research function.
- **Gemini_Engine**: The Gemini 2.5 Pro Deep Research call, specialized for Reddit, English cross-border media, Google-indexed Chinese seller forums, and Amazon official announcements
- **Kimi_Engine**: The Kimi Explore call, specialized for 小红书, 抖音, deep Chinese seller forums, and 微信公众号 sources
- **Synthesizer**: OpenRouter-backed LLM (Claude / GPT-4o class) that receives both engine outputs, dedupes findings, tags confidence, and produces a valid `ReportContent` object
- **Confidence_Tag**: A string attached to each finding indicating cross-validation status. Values: `"High Confidence · 2/2 sources"` (both engines found it) or `"Needs Verification · 1/2 sources"` (only one engine found it)
- **Coverage_Window**: The date range the research covers. For a weekly Monday run at 09:00 Asia/Shanghai, Coverage_Window = previous Monday 00:00 through previous Sunday 23:59 (Asia/Shanghai). For a biweekly run, the window spans 14 days.
- **Schedule_Config**: Admin-editable settings that define when and how the scheduler fires
- **Prompt_Template**: Admin-editable text defining the instructions sent to Gemini_Engine, Kimi_Engine, or Synthesizer. Supports placeholders like `{start_date}`, `{end_date}`, `{week_label}`, `{domain_name}`, `{gemini_output}`, `{kimi_output}`.
- **Scheduled_Run**: A single execution record of the scheduler, successful or failed, manual or scheduled
- **Skeleton_Draft**: A minimally-populated draft report (title + date range + empty/placeholder modules) created when the research pipeline fails, so the admin has a starting point
- **Week_Label**: A string in `"MMDD to MMDD"` format (e.g., `"0302 to 0308"`) identifying the Coverage_Window. Used by the existing dashboard trend chart.
- **Admin**: A user with `role='admin'` in the `profiles` table
- **Report**: A row in the existing `reports` table (schema unchanged by this spec)

## Requirements

### Requirement 1: Schedule Configuration Management

**User Story:** As an admin, I want to configure when the scheduled regular report runs, so that I can align report delivery with my team's review cycle without code changes.

#### Acceptance Criteria

1. THE Schedule_Config SHALL persist the following fields: `enabled` (boolean), `cadence` (`weekly` | `biweekly`), `day_of_week` (`monday`..`sunday`), `time_of_day` (`HH:MM` 24-hour), `domain_id` (fixed to Account Health for V1), `report_type` (fixed to `regular` for V1), `timezone` (fixed to `Asia/Shanghai` for V1)
2. THE Schedule_Config SHALL have exactly one row per domain
3. WHEN an admin submits valid Schedule_Config values, THE System SHALL persist the values and reschedule the next Scheduler execution to match
4. IF a non-admin user attempts to read or modify Schedule_Config, THEN THE System SHALL reject the request with an authorization error
5. IF `time_of_day` is not a valid `HH:MM` string in the range `00:00` to `23:59`, THEN THE System SHALL reject the submission with a descriptive validation error
6. WHEN Schedule_Config.enabled is `false`, THE Scheduler SHALL NOT fire scheduled runs for that domain

### Requirement 2: Prompt Template Management

**User Story:** As an admin, I want to edit the Gemini, Kimi, and Synthesizer prompts directly, so that I can refine research quality over time without engineering involvement.

#### Acceptance Criteria

1. THE System SHALL persist three editable Prompt_Templates per domain: `gemini_prompt`, `kimi_prompt`, `synthesizer_prompt`
2. THE System SHALL ship with non-empty default values for all three Prompt_Templates
3. WHEN an admin submits an updated Prompt_Template, THE System SHALL persist the new text and use it for all subsequent Scheduled_Runs
4. IF the `synthesizer_prompt` does not contain both the `{gemini_output}` and `{kimi_output}` placeholders, THEN THE System SHALL reject the save with a validation error explaining why these placeholders are required
5. WHEN an admin clicks "Reset to default", THE System SHALL replace the current template with the shipped default value for that template
6. IF a non-admin user attempts to read or modify a Prompt_Template, THEN THE System SHALL reject the request with an authorization error

### Requirement 3: Scheduled Trigger

**User Story:** As an admin, I want the report to be generated automatically on my configured cadence, so that I don't have to remember to kick it off each week.

#### Acceptance Criteria

1. WHEN Schedule_Config.enabled is `true` AND the current Asia/Shanghai wall-clock time matches `day_of_week` and `time_of_day`, THE Scheduler SHALL fire a Scheduled_Run with `trigger_type='scheduled'`
2. THE Scheduler SHALL execute outside Vercel's 10-second serverless execution limit by running as an Inngest function, not as a Vercel route handler
3. WHEN the Scheduler fires, THE System SHALL compute the Coverage_Window from the trigger time (weekly: previous Monday 00:00 through previous Sunday 23:59 Asia/Shanghai; biweekly: the 14-day window ending at the previous Sunday 23:59 Asia/Shanghai)
4. WHEN the Scheduler fires, THE System SHALL compute the Week_Label as `"MMDD to MMDD"` from the Coverage_Window start and end dates
5. IF a Scheduled_Run is already in `queued` or `running` status for the same domain and Coverage_Window, THEN THE System SHALL NOT create a duplicate Scheduled_Run (idempotency)

### Requirement 4: Manual Trigger

**User Story:** As an admin, I want a "trigger now" button, so that I can regenerate a draft on demand without waiting for the next scheduled run.

#### Acceptance Criteria

1. WHEN an admin invokes the manual trigger, THE System SHALL create a Scheduled_Run with `trigger_type='manual'`
2. WHEN the manual trigger is invoked, THE System SHALL use the current time as the trigger time and compute Coverage_Window and Week_Label using the same rules as Requirement 3.3 and 3.4
3. IF a non-admin user invokes the manual trigger, THEN THE System SHALL reject the request with an authorization error
4. IF a Scheduled_Run is already in `queued` or `running` status for the same domain and Coverage_Window, THEN THE System SHALL reject the manual trigger with a message indicating a run is already in progress
5. WHERE an admin manually triggers a run, THE System SHALL allow the run to proceed even when Schedule_Config.enabled is `false`

### Requirement 5: Dual-Engine Research Execution

**User Story:** As an admin, I want the report content generated by two specialized AI engines in parallel with cross-validation, so that coverage is wider and findings carry a confidence signal.

#### Acceptance Criteria

1. WHEN a Scheduled_Run enters `running` status, THE Research_Engine SHALL invoke Gemini_Engine and Kimi_Engine in parallel
2. THE Research_Engine SHALL pass the resolved Prompt_Template text (with `{start_date}`, `{end_date}`, `{week_label}`, `{domain_name}` placeholders substituted) to each engine
3. WHEN both Gemini_Engine and Kimi_Engine return output, THE Research_Engine SHALL invoke the Synthesizer with `{gemini_output}` and `{kimi_output}` placeholders substituted in the synthesizer_prompt
4. THE Synthesizer SHALL return a `ReportContent` object with `title`, `dateRange`, and exactly four modules in this order: "Account Suspension Trends", "Listing Takedown Trends", "Account Health Tool Feedback", "Education Opportunities"
5. THE Synthesizer SHALL attach a Confidence_Tag to each finding by populating the `label` field of the corresponding `ContentBlock` with either `"High Confidence · 2/2 sources"` or `"Needs Verification · 1/2 sources"`
6. IF only one of Gemini_Engine or Kimi_Engine returns output within the engine timeout, THEN THE Research_Engine SHALL still invoke the Synthesizer with the single output, and all findings SHALL be tagged `"Needs Verification · 1/2 sources"`
7. THE Research_Engine SHALL accept Coverage_Window, domain_name, and the three Prompt_Templates as inputs, and SHALL return a `ReportContent` object — with no knowledge of the `reports` table, Schedule_Config, or notifications (reuse-readiness for future topic-specific deep-dive use case)

### Requirement 6: Draft Report Creation

**User Story:** As an admin, I want the AI-generated content saved as a draft I can review and edit, so that I retain editorial control before the team sees it.

#### Acceptance Criteria

1. WHEN the Research_Engine returns a valid `ReportContent` object, THE System SHALL insert a new row into the `reports` table with `status='draft'`, `type='regular'`, `domain_id` from the Schedule_Config, `week_label` from the Scheduled_Run, `date_range` from the Coverage_Window, and `content` set to the returned `ReportContent`
2. THE System SHALL link the created draft to its Scheduled_Run so the admin can navigate from the run history to the draft
3. THE System SHALL NOT call translate, topic-extract, or hot-news logic during draft creation (these run only at publish time via the existing `/api/reports/[id]/publish` endpoint)
4. IF the same Scheduled_Run attempts to create a draft report a second time, THEN THE System SHALL NOT create a duplicate draft (idempotency at draft-creation step)

### Requirement 7: Failure Handling and Skeleton Draft

**User Story:** As an admin, I want a notification and a usable starting point when the AI pipeline fails, so that I can still deliver a weekly report without losing the cycle.

#### Acceptance Criteria

1. IF both Gemini_Engine and Kimi_Engine fail to return output, THEN THE System SHALL create a Skeleton_Draft with `status='draft'`, correct `week_label` and `date_range`, and the four module titles present with empty `blocks` arrays
2. IF the Synthesizer fails to return a valid `ReportContent` object, THEN THE System SHALL create a Skeleton_Draft as defined in 7.1 and include the raw engine outputs in the Scheduled_Run record for admin debugging
3. IF the OpenRouter API returns a credits-exhausted error (HTTP 402 or equivalent error code), THEN THE System SHALL mark the Scheduled_Run as `failed` with `failure_reason` containing the literal phrase `"OpenRouter credits exhausted"` and create a Skeleton_Draft
4. IF Gemini_Engine times out or returns an error, THEN THE Scheduled_Run SHALL record `failure_reason` including the phrase `"Gemini"` and the specific error class
5. IF Kimi_Engine times out or returns an error, THEN THE Scheduled_Run SHALL record `failure_reason` including the phrase `"Kimi"` and the specific error class
6. WHEN a Skeleton_Draft is created due to failure, THE Scheduled_Run status SHALL be `failed` (both engines failed) or `partial` (one engine succeeded but synthesis failed)

### Requirement 8: Admin Notifications

**User Story:** As an admin, I want to be notified when a scheduled draft is ready or when a run fails, so that I know when to review content or investigate problems.

#### Acceptance Criteria

1. WHEN a Scheduled_Run completes with status `succeeded`, THE System SHALL create an in-app notification for every user with `role='admin'` containing a link to the created draft
2. WHEN a Scheduled_Run completes with status `failed` or `partial`, THE System SHALL create an in-app notification for every user with `role='admin'` containing the `failure_reason` and a link to the Scheduled_Run detail page
3. THE System SHALL NOT create notifications for users with `role='team_member'` for scheduled draft creation — team notifications are created only when the admin publishes the draft through the existing `/api/reports/[id]/publish` endpoint (unchanged by this spec)

### Requirement 9: Scheduled-Run History Page

**User Story:** As an admin, I want a page that shows all past scheduled runs with their outcomes, so that I can audit the system and diagnose problems.

#### Acceptance Criteria

1. THE System SHALL provide a page at `/admin/scheduled-runs` that lists Scheduled_Runs in reverse chronological order
2. THE `/admin/scheduled-runs` page SHALL display these columns per row: Run ID (short, clickable), Triggered At (Asia/Shanghai timestamp), Trigger Type (`scheduled` | `manual`), Status (`queued` | `running` | `succeeded` | `failed` | `partial`), Duration (seconds), Draft Report Link (if a draft was created), Failure Reason (short text), Actions (Retry, View Logs)
3. THE `/admin/scheduled-runs` page SHALL paginate results at 20 rows per page
4. WHEN an admin clicks "View Logs" on a Scheduled_Run row, THE System SHALL display the Gemini output, Kimi output, Synthesizer output, and any error messages captured during that run
5. WHEN an admin clicks "Retry" on a `failed` or `partial` Scheduled_Run, THE System SHALL create a new Scheduled_Run with `trigger_type='manual'` using the original Coverage_Window
6. IF a non-admin user attempts to access `/admin/scheduled-runs`, THEN THE System SHALL reject the request with an authorization error

### Requirement 10: Non-Functional — Execution Environment

**User Story:** As a platform operator, I want the long-running research pipeline to run outside Vercel's serverless time limit, so that it doesn't fail due to platform constraints.

#### Acceptance Criteria

1. THE Research_Engine SHALL execute as an Inngest function, not inside a Vercel route handler
2. THE Vercel-hosted endpoints related to scheduling SHALL only enqueue Inngest events or receive Inngest webhook callbacks — no synchronous research execution
3. WHEN the Research_Engine exceeds 10 seconds of wall time, THE System SHALL continue executing to completion without error (the 10-second Vercel Hobby limit does not apply to Inngest functions)

### Requirement 11: Non-Functional — Idempotency

**User Story:** As a platform operator, I want duplicate triggers to be safe, so that a double-fire from Inngest or a double-click on the manual trigger does not produce duplicate drafts.

#### Acceptance Criteria

1. WHEN two or more trigger events arrive for the same domain and Coverage_Window within a short window, THE System SHALL accept exactly one and reject the others (via a unique constraint or equivalent deduplication key)
2. IF a previously-completed Scheduled_Run is replayed (e.g., Inngest retry after a transient network error), THEN THE System SHALL NOT create a second draft for the same Coverage_Window

### Requirement 12: Non-Functional — Timezone Correctness

**User Story:** As a China-based admin, I want schedule triggers and Week_Label values to always reflect Asia/Shanghai, so that reports align with the working week my team operates in.

#### Acceptance Criteria

1. THE Scheduler SHALL interpret `day_of_week` and `time_of_day` in Asia/Shanghai time regardless of the server's host timezone
2. THE Week_Label SHALL be computed from Coverage_Window boundaries expressed in Asia/Shanghai time
3. THE `/admin/scheduled-runs` page SHALL display all timestamps in Asia/Shanghai with an explicit timezone indicator

### Requirement 13: Non-Functional — Secret Privacy

**User Story:** As a security-conscious operator, I want all engine API keys kept server-side, so that they are never exposed to the client or to non-admin users.

#### Acceptance Criteria

1. THE System SHALL NOT expose OpenRouter, Gemini, or Kimi API keys via any client-visible variable, response body, or admin-facing UI
2. IF an admin views the Prompt_Template settings, THEN THE System SHALL render only the editable prompt text — no API keys, endpoint URLs with embedded credentials, or model identifiers that encode secret information

### Requirement 14: Non-Functional — Research Engine Reuse-Readiness

**User Story:** As a product owner, I want the Research_Engine built as a standalone module, so that a future topic-specific deep-dive feature can reuse it without refactoring.

#### Acceptance Criteria

1. THE Research_Engine SHALL be implemented as a pure async function taking `{ coverage_window, domain_name, gemini_prompt, kimi_prompt, synthesizer_prompt }` and returning `{ content: ReportContent | null, engine_outputs, errors }`
2. THE Research_Engine SHALL NOT import or depend on any code related to `reports` table writes, Schedule_Config reads, notification creation, or Inngest events
3. FOR ALL inputs producing the same engine responses (mocked), the Research_Engine SHALL produce functionally equivalent output (deterministic up to LLM non-determinism — i.e., the merge/dedupe/confidence-tag logic SHALL be deterministic given fixed engine responses)

## Correctness Properties (for Property-Based Testing)

The following properties are candidates for property-based tests during implementation. Each property tests a single behavioral invariant and can be driven with generated inputs.

1. **Schedule-trigger correctness**: For any Schedule_Config with `enabled=true`, if the current Asia/Shanghai time matches `day_of_week` and `time_of_day` (down to the minute), the Scheduler SHALL fire exactly one Scheduled_Run. If disabled, it SHALL fire zero.
2. **Trigger idempotency**: For any pair of trigger events with the same `(domain_id, coverage_window)` arriving within 1 minute of each other, exactly one Scheduled_Run row SHALL be created.
3. **Draft-state invariant**: After a successful Scheduled_Run, the created `reports` row SHALL have `status='draft'` AND `type='regular'` AND `week_label` matching the `MMDD to MMDD` format AND `content.modules.length === 4`.
4. **Week_Label round-trip**: For any trigger time T (Asia/Shanghai), computing Coverage_Window from T and then computing Week_Label from Coverage_Window SHALL produce a string matching `/^\d{4} to \d{4}$/`, and parsing those two month-day pairs back SHALL yield dates exactly 6 days apart (weekly) or 13 days apart (biweekly).
5. **Coverage_Window boundary correctness**: For any Monday 09:00 Asia/Shanghai trigger time, Coverage_Window start SHALL be the immediately preceding Monday 00:00 and Coverage_Window end SHALL be the immediately preceding Sunday 23:59, both in Asia/Shanghai.
6. **Failure-mode naming**: For any simulated OpenRouter 402 response, the resulting Scheduled_Run's `failure_reason` SHALL contain the literal substring `"OpenRouter credits exhausted"`.
7. **Skeleton_Draft shape**: For any Scheduled_Run that produces a Skeleton_Draft, the draft's `content.modules` array SHALL have exactly 4 entries with titles `["Account Suspension Trends", "Listing Takedown Trends", "Account Health Tool Feedback", "Education Opportunities"]` in that order, and each module's `blocks` SHALL be an empty array.
8. **Confidence-tag completeness**: For any Synthesizer output where both engines returned findings, every `ContentBlock` in the produced `ReportContent` SHALL have a `label` field whose value is either `"High Confidence · 2/2 sources"` or `"Needs Verification · 1/2 sources"` (no missing labels, no other values).
9. **Confidence-tag single-engine invariant**: For any Synthesizer output produced from only one engine's response (the other failed), every `ContentBlock.label` SHALL equal `"Needs Verification · 1/2 sources"`.
10. **Notification creation on success**: For any Scheduled_Run transitioning to `succeeded`, the number of notifications created SHALL equal the number of users with `role='admin'`, each containing the created draft's ID as `reference_id`.
11. **Notification creation on failure**: For any Scheduled_Run transitioning to `failed` or `partial`, the number of notifications created SHALL equal the number of users with `role='admin'`, each containing the Scheduled_Run ID as `reference_id` and a non-empty `failure_reason` text.
12. **No team-member notification on scheduled draft**: For any Scheduled_Run regardless of outcome, the number of notifications created with recipient `role='team_member'` SHALL be zero (team notifications are only created by the existing publish flow).
13. **Research_Engine purity**: For any fixed triple of mocked engine responses `(gemini_response, kimi_response, synthesizer_response)`, calling `research_engine.run(...)` twice with identical inputs SHALL produce identical outputs (the merge/dedupe/confidence-tag logic is deterministic).
14. **Research_Engine isolation**: The Research_Engine module SHALL have zero static imports of `reports`-table modules, Schedule_Config modules, notification modules, or Inngest client modules (verified by import-graph inspection).
15. **Synthesizer-prompt placeholder enforcement**: For any attempt to save a `synthesizer_prompt` missing either `{gemini_output}` or `{kimi_output}`, the save SHALL be rejected, and the persisted value SHALL remain unchanged.
