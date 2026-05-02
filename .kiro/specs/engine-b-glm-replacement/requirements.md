# Requirements Document

## Introduction

Engine B — the second research engine whose role in this platform is to provide **cross-engine heterogeneity** against Engine A (Moonshot Kimi) during hot-radar scan and deep-dive — has failed every production run for the past 24 hours, across **five** successive fix attempts. Each attempt targeted a different facet of Alibaba DashScope's Qwen API (model family, hybrid-thinking toggle, parameter placement, model list compliance) and each was rejected by a different undocumented runtime constraint. The current state: `scheduled_runs.b_ok = false, b_refs = 0` on every run; the Synthesizer sees only Engine A output, collapsing the two-engine confirmation design to a single-source report.

This feature replaces Engine B's backend from **Alibaba DashScope / Qwen** to **Zhipu AI / GLM (z.ai)**. The replacement preserves all observable contracts of Engine B as a pipeline stage — the DB column `scheduled_runs.kimi_output`, the JSONB shape, the 4-stage breakdown (hot-radar → deep-dive → education-mapper → assembler), the stage timeouts (240s / 240s / 60s / 90s), and the downstream Synthesizer's expectations — while swapping out the underlying LLM + web-search provider. File names (`kimi.ts`, `kimi_output`) are preserved as stable historical identifiers; the "kimi" label is product-internal shorthand for "Engine B" and has been decoupled from the actual backend since 2026-03.

### Why Zhipu GLM (verified against official docs at https://docs.z.ai/guides/tools/web-search)

1. **Clean OpenAI-compatible API surface**. Web search is declared as a standard OpenAI tool: `tools: [{ type: "web_search", web_search: {...} }]`. This is the same shape as Moonshot's `$web_search` — so Engine B's client can structurally mirror `moonshot-client.ts` rather than invent a two-step workaround.
2. **Non-streaming + JSON + web-search is natively supported**. GLM has no equivalent of DashScope's "thinking mode forbids non-streaming + search" constraint. `response_format: { type: 'json_object' }` can be combined with the web-search tool in a **single** HTTP call.
3. **Strong Chinese community coverage**. Tsinghua lineage; CN-native search index comparable to Qwen 夸克 for e-commerce, 1688/Taobao, 小红书, 知乎 — the sources Engine B was originally introduced to cover.
4. **Built-in `search_recency_filter`** with values `noLimit | oneDay | oneWeek | oneMonth | oneYear`. This is an **API-level** date filter — directly addresses the "2021-2023 citations in WK17 reports" problem that neither Qwen nor Moonshot expose at the API layer. (Principle 2: API constraint > prompt hope.)
5. **Results include a `publish_date` field**, enabling a code-layer second-pass filter against the run's `coverage_window`.
6. **Paid plans with straightforward pricing**; free tier (`glm-4-flash`) available for development and fallback.
7. **Native structured output** via `response_format: { type: 'json_object' }` on every supported model — no two-step search→structure dance required.

### Scope boundary

This feature is **only** Engine B's backend swap. It is deliberately narrow:

- Replaced: the Stage 1/2 LLM + web-search provider inside `runKimiLoop`.
- Preserved: every observable contract — DB shape, Stage 1-4 structure, Synthesizer interface, module keys, severity schema, tool-feedback schema, search-reference shape.
- Not in scope (each is a separate spec already planned):
  - Moonshot timeout investigation (Engine A reliability is a separate problem).
  - Stage 4 assembler connection-reset bug.
  - `MAX_ITERATIONS` tuning for either engine.
  - Code-layer normalization of `first_seen_date` across the pipeline.
  - Synthesizer prompt or behavior changes.

## Glossary

- **Engine_B**: The second of two parallel research engines in the Inngest pipeline. Historically: Moonshot via OpenRouter (2026-03) → OpenRouter :online DeepSeek (2026-04) → Alibaba Qwen direct (2026-05, broken). This feature sets Engine_B = **Zhipu GLM (z.ai) direct**.
- **Engine_A**: The first research engine. Moonshot Kimi direct with `$web_search` builtin tool. Unchanged by this feature.
- **GLM**: Zhipu AI's model family (General Language Model). Served via the z.ai OpenAI-compatible endpoint.
- **Zai_Client**: The new TypeScript module (canonical file path `src/lib/research-engine/engines/zai-client.ts`) that wraps the GLM chat-completions endpoint with `web_search` tool support. Structurally mirrors `moonshot-client.ts`. Replaces `qwen-client.ts` as Engine_B's backend callsite.
- **Researcher_Model_B**: The specific GLM model id used for Engine B Stage 1 / Stage 2 calls. Candidate values (user to confirm): `glm-4-plus`, `glm-4-air`, `glm-4-flash`. Default proposed: `glm-4-plus`.
- **Stage_1_Timeout**: 240 000 ms. Unchanged from current kimi.ts.
- **Stage_2_Timeout**: 240 000 ms per topic. Unchanged.
- **Stage_3_Timeout**: 60 000 ms. Unchanged.
- **Stage_4_Timeout**: 90 000 ms. Unchanged.
- **Coverage_Window**: The `{ startIso, endIso, weekLabel }` object passed through the engine loop. Defines the time range for which topics are considered "fresh".
- **Search_Recency_Filter**: GLM's native parameter (`noLimit | oneDay | oneWeek | oneMonth | oneYear`) passed inside the `web_search` tool config to instruct GLM's search index to restrict results by publish date.
- **Publish_Date_Filter**: Code-layer (in `zai-client.ts` or `loop.ts`) secondary filter that drops any `EngineSearchReference` whose GLM-returned `publish_date` is outside the run's `Coverage_Window`. Exists because `Search_Recency_Filter` is anchored to "now", not to the run's nominal window.
- **Engine_Error_Class**: The existing `EngineErrorClass` string-literal enum: `'ServerError' | 'TimeoutError' | 'NetworkError' | 'CreditsExhausted' | 'RateLimited' | 'MalformedResponse'`. This feature adds no new members.
- **DB_Column_Kimi_Output**: `scheduled_runs.kimi_output` — JSONB column that stores Engine_B's `EngineAssembledContent | null`. Name retained; shape unchanged.
- **Env_Var_ZAI_Key**: The new environment variable `ZAI_API_KEY`. Replaces the role of `QWEN_API_KEY`.
- **Env_Var_Qwen_Key**: The existing environment variable `QWEN_API_KEY`. Status determined by open question §Q6.
- **Researcher_Provider**: The `ResearcherProvider` union in `loop.ts`: `'openrouter' | 'moonshot' | 'qwen'`. This feature replaces the `'qwen'` member with `'zai'`. (Alternative: keep `'qwen'` as an alias routing to the GLM client — see §Q3.)
- **Synthesizer**: Downstream consumer of Engine_A + Engine_B outputs. Never contacts LLM providers directly; consumes the DB columns `gemini_output` + `kimi_output` after both engines complete.
- **Hot_Radar_Topic**: The canonical Stage 1 output unit — `{ rank, topic, voice_volume, keywords, seller_discussion, severity, channel_counts, channels_observed, initial_misconception, initial_evidence }`. Shape governed by the existing `normalizeHotRadarTopic` in `loop.ts`. Unchanged by this feature.
- **Deep_Dive_Output**: The canonical Stage 2 output unit per (module, topic). Shape governed by `normalizeDeepDive`. Unchanged.

## Requirements

### Requirement 1 — GLM client exists and is invocable

**User Story:** As a platform maintainer, I want a `Zai_Client` module that wraps GLM's chat-completions endpoint, so that Engine_B Stage 1 and Stage 2 can call GLM without any DashScope-specific workarounds.

#### Acceptance Criteria

1. THE Zai_Client SHALL expose a single public function `callZai<T>(params)` that accepts `{ model, messages, apiKey, timeoutMs, jsonMode?, searchRecency?, errorContext }` and returns the discriminated union `{ ok: true, data: T, rawContent, searchReferences, searchCount } | { ok: false, error: EngineError }`.
2. WHEN `callZai` is invoked with `jsonMode: true`, THE Zai_Client SHALL include `response_format: { type: 'json_object' }` in the outgoing HTTP body.
3. WHEN `callZai` is invoked, THE Zai_Client SHALL include the web-search tool declaration `{ type: 'web_search', web_search: { search_result: true } }` (plus any configured recency filter) in the outgoing HTTP body.
4. WHEN `callZai` receives an HTTP 200 response, THE Zai_Client SHALL parse `choices[0].message.content` as JSON (after stripping markdown code fences) and return it as the `data` field of the success variant.
5. WHEN `callZai` receives an HTTP 200 response containing GLM search-result metadata, THE Zai_Client SHALL extract each result's `url`, `title`, `publish_date`, and `snippet` into `EngineSearchReference[]`, deduplicated by URL, and return them as the `searchReferences` field.
6. WHEN `callZai` completes successfully, THE Zai_Client SHALL return a non-negative integer `searchCount` derived from the number of web_search tool invocations in the response (or equivalently the length of the search-results array when invocation count is unavailable).

### Requirement 2 — GLM HTTP error classification

**User Story:** As a platform maintainer, I want GLM errors mapped to the existing `EngineErrorClass` enum, so that the existing retry and DB-logging code paths work unchanged.

#### Acceptance Criteria

1. WHEN the z.ai endpoint returns HTTP 401 OR HTTP 402 OR HTTP 403, THE Zai_Client SHALL return `{ ok: false, error: { errorClass: 'CreditsExhausted', httpStatus, ... } }`.
2. WHEN the z.ai endpoint returns HTTP 429, THE Zai_Client SHALL return `{ ok: false, error: { errorClass: 'RateLimited', httpStatus, ... } }`.
3. WHEN the z.ai endpoint returns any HTTP status in the range 500-599, THE Zai_Client SHALL return `{ ok: false, error: { errorClass: 'ServerError', httpStatus, ... } }`.
4. IF the fetch call throws a native `AbortError` (caller-timeout exhaustion), THEN THE Zai_Client SHALL return `{ ok: false, error: { errorClass: 'TimeoutError', ... } }`.
5. IF the fetch call throws any other `Error` (network failure, DNS, TLS), THEN THE Zai_Client SHALL return `{ ok: false, error: { errorClass: 'NetworkError', ... } }`.
6. WHEN the HTTP 200 response body fails JSON parsing OR is missing `choices[0].message.content`, THE Zai_Client SHALL return `{ ok: false, error: { errorClass: 'MalformedResponse', ... } }`.
7. WHERE an HTTP 5xx response OR a NetworkError occurs AND the retry budget is not exhausted, THE Zai_Client SHALL retry the request with exponential backoff before returning a failure.

### Requirement 3 — Engine B routes through GLM end-to-end

**User Story:** As a report author whose scheduled runs I watch in `/admin/scheduled-runs`, I want Engine B to execute to completion via GLM, so that cross-engine heterogeneity is restored.

#### Acceptance Criteria

1. WHEN `runKimiLoop` is invoked during a scheduled run, THE Kimi_Engine SHALL dispatch Stage 1 and Stage 2 LLM calls through `callZai` instead of `callQwen`.
2. WHEN Stage 1 (`hot-radar-scan`) completes successfully, THE Kimi_Engine SHALL produce a `HotRadarOutput` that passes the existing `normalizeHotRadar` validator without any schema change.
3. WHEN Stage 2 (`deep-dive`) completes successfully for a given (module, topic) pair, THE Kimi_Engine SHALL produce a `DeepDiveOutput` that passes the existing `normalizeDeepDive` validator without any schema change.
4. WHEN all four stages complete successfully, THE Kimi_Engine SHALL populate `scheduled_runs.kimi_output` with a JSON value matching the existing `EngineAssembledContent` shape.
5. WHEN a scheduled run reaches the post-engine synthesizer step, THE Synthesizer SHALL receive Engine_B's output from `scheduled_runs.kimi_output` with zero code-level changes on the Synthesizer side.
6. WHEN a scheduled run completes under normal operating conditions, THE System SHALL set `scheduled_runs.b_ok = true` AND `scheduled_runs.b_refs > 3` on the resulting row.

### Requirement 4 — Search freshness and broad CN-community coverage

**User Story:** As a report reader, I want Engine B's citations to come from recent, Chinese-language community sources, so that the weekly reports reflect the current conversation among CN sellers.

#### Acceptance Criteria

1. WHEN Stage 1 (`hot-radar-scan`) invokes `callZai`, THE Kimi_Engine SHALL pass a `search_recency_filter` value of `oneWeek`.
2. WHEN Stage 2 (`deep-dive`) invokes `callZai`, THE Kimi_Engine SHALL pass a `search_recency_filter` value of `oneMonth`.
3. WHEN the GLM response contains a `publish_date` for a given search result, THE Zai_Client SHALL retain that date on the resulting `EngineSearchReference.published_date` field.
4. WHEN a scheduled run completes, THE Kimi_Engine SHALL have recorded at least 3 `EngineSearchReference` entries with non-empty URL and non-empty title.
5. WHEN a scheduled run completes, the operator SHALL manually review the resulting draft report's citations and subjectively judge CN-community coverage quality; no SQL-enforced domain whitelist is applied. If coverage is poor, remediation is a prompt-layer adjustment in a follow-up spec, not a code change in this spec.

### Requirement 5 — Environment and configuration

**User Story:** As the operator deploying this change, I want a single new environment variable and a clean removal of the old one, so that deployment is explicit and no dead credentials linger.

#### Acceptance Criteria

1. THE Kimi_Engine SHALL read its credential from `process.env.ZAI_API_KEY`.
2. IF `process.env.ZAI_API_KEY` is undefined OR empty at the time `runKimiLoop` is invoked, THEN THE Kimi_Engine SHALL fail fast with `{ errorClass: 'ServerError', message: 'ZAI_API_KEY is missing' }` before any HTTP call.
3. WHEN the deployment is complete, THE Codebase SHALL contain no references to `process.env.QWEN_API_KEY` in production code paths.
4. WHEN the deployment is complete, THE Kimi_Engine SHALL contain no runtime import of `callQwen` from `qwen-client.ts`.
5. THE Deployment_Documentation SHALL include a note stating that the operator must add `ZAI_API_KEY` to Vercel environment variables and trigger a redeploy before the first scheduled run after merge.

### Requirement 6 — Preservation of Engine B's observable contract

**User Story:** As a downstream consumer of Engine B's output (Synthesizer, dashboard DB queries, archived `scheduled_runs` rows), I want zero behavioral change in what Engine B emits, so that no downstream code, dashboard, or historical row needs migrating.

#### Acceptance Criteria

1. THE DB Column DB_Column_Kimi_Output SHALL retain its name `kimi_output` on `scheduled_runs`.
2. THE DB Column DB_Column_Kimi_Output SHALL retain its existing JSONB shape matching `EngineAssembledContent` (fields: `title`, `dateRange`, `modules[]`, plus trace-embedded `hotRadar`, `deepDives`, `educationOpportunities`, `searchReferences`).
3. THE File `src/lib/research-engine/engines/kimi.ts` SHALL retain its filename and its exported function name `runKimiLoop`.
4. THE 4-stage structure (`hot-radar-scan` → `deep-dive` → `education-mapper` → `assembler`) SHALL remain unchanged, with the same stage names used in Inngest step identifiers.
5. THE Stage_1_Timeout, Stage_2_Timeout, Stage_3_Timeout, AND Stage_4_Timeout SHALL remain at 240 000 ms, 240 000 ms, 60 000 ms, AND 90 000 ms respectively.
6. THE Stage 3 education-mapper AND Stage 4 assembler SHALL continue to use `callOpenRouter` against the `moonshotai/kimi-k2-0905` model (unchanged by this feature).
7. THE Engine_A pipeline (`runGeminiLoop`, `callMoonshot`, Stage 1/2 using `kimi-k2.6`) SHALL behave byte-identically before and after this feature lands.
8. THE existing normalizer functions (`normalizeHotRadar`, `normalizeHotRadarTopic`, `normalizeToolFeedbackItem`, `normalizeDeepDive`, `normalizeEducationOpportunity`) SHALL remain unchanged.
9. THE `EngineErrorClass` union SHALL remain unchanged (no new members introduced).

### Requirement 7 — Test coverage

**User Story:** As the platform maintainer, I want the new GLM client covered by unit tests equivalent to what `qwen-client.test.ts` provides today, so that regressions on error classification, response-shape parsing, and retry are caught at CI time.

#### Acceptance Criteria

1. THE Test Suite `src/lib/research-engine/engines/__tests__/zai-client.test.ts` SHALL exist and cover the following cases: successful JSON parse, web_search tool call round-trip, `search_recency_filter` is forwarded to the request body, 401 classified as `CreditsExhausted` without retry, 429 classified as `RateLimited`, transient 500 retried once then succeeds, malformed response body classified as `MalformedResponse`, abort classified as `TimeoutError`, and search references deduped by URL.
2. WHEN `npm run build` is executed on the new codebase, THE Build SHALL complete with zero TypeScript errors.
3. WHEN `npx vitest run src/lib/research-engine/engines/__tests__/zai-client.test.ts` is executed, THE Test Suite SHALL report all cases passing.
4. THE Test Suite `src/lib/research-engine/engines/__tests__/qwen-client.test.ts` status SHALL be determined by §Q8 (kept as archival / removed / repurposed).

### Requirement 8 — Observability for post-deploy verification

**User Story:** As the operator running the first post-merge scheduled run, I want a single SQL query to confirm the swap worked, so that verification is measurable and not "looks okay".

#### Acceptance Criteria

1. WHEN a scheduled run completes after this feature is deployed, THE Operator SHALL be able to verify success by running a single SQL query against `scheduled_runs` and checking the most recent row against these columns: `status = 'succeeded'`, `b_ok = true`, `b_refs > 3`, `b_error_class IS NULL`.
2. WHEN a scheduled run completes after this feature is deployed, THE `scheduled_runs.kimi_output` JSONB on that row SHALL contain at least 3 `searchReferences` entries each with a non-empty `url` and `title`. Subjective quality review of CN-community coverage is the operator's responsibility (Requirement 4.5) and is not a deployment gate.
3. IF the first post-deploy scheduled run records `b_ok = false`, THEN THE Run_Trace SHALL contain an `EngineError` entry with non-empty `errorClass` AND `message` fields enabling a next-step diagnosis.

## Non-Functional Requirements

### Requirement 9 — Reliability

#### Acceptance Criteria

1. WHERE a single z.ai HTTP call transiently fails with a 5xx status OR a NetworkError, THE Zai_Client SHALL retry at least once before returning a failure.
2. WHEN a scheduled run completes under nominal conditions (z.ai endpoint available, network stable, quota not exceeded), THE Kimi_Engine SHALL produce `b_ok = true` on at least 9 out of 10 consecutive daily runs over a two-week observation window.
3. IF Engine_B fails for a given run, THEN THE Engine_A pipeline SHALL complete independently and the Synthesizer SHALL still produce a single-engine report without aborting the whole scheduled run.

### Requirement 10 — Latency (within Principle 1 limits)

#### Acceptance Criteria

1. THE Stage_1_Timeout SHALL remain at 240 000 ms to accommodate cross-border network latency and multi-round search.
2. WHEN a Stage 1 or Stage 2 z.ai call exceeds its allotted stage timeout, THE Kimi_Engine SHALL abort that stage with `errorClass: 'TimeoutError'` — consistent with existing behavior.
3. THE Kimi_Engine total wall time SHALL remain within the Vercel Pro Inngest serverless 300 s per-step ceiling under nominal conditions.

### Requirement 11 — Cost

#### Acceptance Criteria

1. THE Researcher_Model_B SHALL be a currently-priced GLM SKU (flagship, air, or flash) as determined by §Q4.
2. WHEN the daily scheduled-run volume is at its planned default (one run per domain per week), THE Zhipu_Billing_Exposure SHALL not exceed the monthly budget cap specified by the operator in §Q4.

## Preservation Requirements (Regression Prevention)

The following items MUST remain byte-identical across the diff introduced by this feature. Violations block merge.

### Requirement 12 — What must NOT change

#### Acceptance Criteria

1. WHEN Engine_A runs, THE Moonshot_Client SHALL continue to call `api.moonshot.cn/v1/chat/completions` with model `kimi-k2.6` and the `$web_search` builtin tool.
2. THE Stage 3 education-mapper SHALL continue to invoke `callOpenRouter` with model `moonshotai/kimi-k2-0905`.
3. THE Stage 4 assembler SHALL continue to invoke `callOpenRouter` with model `moonshotai/kimi-k2-0905`.
4. THE DB column `scheduled_runs.kimi_output` SHALL retain its name, its JSONB type, and its `EngineAssembledContent` shape.
5. THE DB column `scheduled_runs.gemini_output` SHALL remain unaffected.
6. THE Synthesizer code path SHALL execute with zero modifications.
7. THE `HOT_RADAR_MODULE_KEYS`, `ChannelType`, `CHANNEL_WEIGHT`, and related type constants SHALL remain unchanged.
8. THE Stage timeout constants (`hotRadarTimeoutMs = 240000`, `deepDiveTimeoutMs = 240000`, `educationMapperTimeoutMs = 60000`, `assemblerTimeoutMs = 90000`) in `kimi.ts` SHALL remain at their current values.
9. WHEN a user views `/admin/scheduled-runs`, THE UI SHALL render without any component-level change attributable to this feature.
10. WHEN a historical `scheduled_runs` row (predating this feature) is queried, THE Report UI SHALL render it without error (backward compatibility with pre-swap JSONB shape).

## Parser and Serializer Requirements

The Zai_Client parses an HTTP JSON envelope into application types, and effectively serializes GLM's search-tool response shape into `EngineSearchReference[]`. Per the requirements-quality standard, both directions are called out explicitly.

### Requirement 13 — GLM envelope parser

#### Acceptance Criteria

1. THE Zai_Client SHALL parse z.ai chat-completions JSON envelopes and extract `choices[0].message.content`.
2. THE Zai_Client SHALL parse the web-search metadata shape (documented at https://docs.z.ai/guides/tools/web-search) into `EngineSearchReference[]`.
3. WHEN the envelope JSON is malformed, THE Zai_Client SHALL return `errorClass: 'MalformedResponse'` with a descriptive message — never throw.
4. FOR ALL valid `EngineSearchReference[]` extracted from a GLM response, serializing the references into the `scheduled_runs.kimi_output.trace.searchReferences` field and re-reading them back from the DB SHALL produce an equivalent array (round-trip property over the already-established DB JSONB).

## Open Questions — to answer before Phase 2 (Design)

These questions shape the design document. The user must resolve them in chat before design work begins. Each is numbered for reply clarity.

### Q1. File-naming strategy for the client module

### Q1. File-naming strategy for the client module — **RESOLVED: Option B**

Create new `src/lib/research-engine/engines/zai-client.ts`, and in the same commit delete `qwen-client.ts` + its test file. Mirrors Moonshot naming convention; removes dead code atomically.

### Q4. Model choice and monthly cost budget

**Status: RESOLVED — `glm-4.6` selected.**

**Decision rationale (from investigation round 2026-05-02)**:

- Quality is the primary concern (user: "成本没问题，要看质量哈"). Cost is secondary.
- Task profile: multi-round search + cross-source aggregation + hot-topic ranking in Chinese seller community. Relevant benchmarks: BrowseComp, agent tool use, CN comprehension. Irrelevant benchmarks: SWE-bench, AIME math, long-context (our prompts stay under 20k tokens).
- **`glm-4.6` is explicitly documented by z.ai as "stronger performance in tool using and search-based agents"** — this is the exact capability Stage 1 / Stage 2 exercise.
- 4.6 has been in production 6+ months (released 2025-09), so community-surfaced bugs are already known and fixed. Contrast with the Qwen experience where each newest-model attempt surfaced a new undocumented constraint.
- 4.6 ($0.6/$2.2) sits at the same price tier as the newer 4.7 and 5 — so "go latest" offers no cost advantage, only novelty risk.
- One-line upgrade path: if 4.6 quality proves insufficient after 2 weeks of observation, model string swap to `glm-4.7` or `glm-5.1` is a single constant change (same protocol, same endpoint, same shape).

**Rejected alternatives**:
- `glm-5.1` (flagship): newest (2026-02) but unproven; risk of undocumented constraints (the Qwen-ecosystem lesson). Cost $1.4/$4.4 not an obstacle, but the "newest = safest" intuition proved wrong in the Qwen debugging cycle.
- `glm-4.5-air` (cost-optimized): strong on benchmarks (officially matches Claude 4 Opus on Agent Artificial Analysis score with 12B active params), but the user's stated priority is quality > cost, not cost > quality.
- Mixed-model (plus for Stage 1, air for Stage 2): adds dispatch complexity to `kimi.ts` for a marginal quality gain. Principle 2 (architecture simple > micro-optimization).

**Concrete choice**: Researcher_Model_B = `glm-4.6` for all four stages inside `runKimiLoop` (actually only Stages 1/2 call GLM; Stages 3/4 continue on OpenRouter per §Requirement 6.2).

**Expected monthly cost** (at planned 1 run per domain per week × 4 domains × ~50k tokens/run): **USD $5-10 per month**. Safely inside "acceptable for a weekly-scheduled B2B reporting platform" for any reasonable operator budget.

### Q2. Single-call vs two-step flow — **RESOLVED: Option A (single-call)**

GLM supports `response_format: json_object` + `tools: web_search` together in a single HTTP call. No DashScope-style incompatibility forces a two-step flow. Ship the simpler single-call architecture.

### Q3. Researcher_Provider enum value — **RESOLVED: Option A**

Rename `ResearcherProvider` enum member `'qwen'` → `'zai'` in `loop.ts`. One-time surgical rename; `loop.ts` is the only file that branches on this value.

### Q7. CN-community domain acceptance list — **RESOLVED: removed**

The original requirements draft specified a whitelist of CN-community domains as a hard acceptance criterion. Upon review, a whitelist was judged unhelpful:

- GLM's web_search is a black box — we cannot steer which domains it prefers.
- CN seller communities are extremely fragmented (WeChat公众号, 知识星球, QQ/微信 群, niche blogs, syndication sites); any static whitelist misses long-tail high-value sources.
- Search-engine result URLs often point to "relay" sites (搜狐、网易 re-hosts of WeChat content), so hostname-based whitelisting produces false negatives.

**Resolution**: Requirement 4.4 was relaxed from "≥ 1 whitelisted-domain reference" to "≥ 3 non-empty references"; CN-community coverage quality is a human-review concern (4.5), not a SQL-enforced gate. If coverage proves poor after first runs, remediation lives in a follow-up prompt-tuning spec.

### Q5. Search_Recency_Filter default per stage — **RESOLVED: Option A (MVP)**

Stage 1 = `oneWeek`, Stage 2 = `oneMonth`. Hardcoded defaults for MVP. Promoting to DB-editable `schedule_configs` is a follow-up spec (not in scope here).

### Q6. `content_size` parameter — **RESOLVED: Option B (tiered)**

Stage 1 = `medium` (extraction-dominated, snippet is enough). Stage 2 = `high` (analysis-dominated, needs richer source text).

### Q8. `QWEN_API_KEY` disposition — **RESOLVED: Option A+C**

Code-level references to `QWEN_API_KEY` are removed inside the GLM-swap PR. The live Vercel env-var entry is removed **by the operator** after the post-merge verification run (Q10) succeeds — i.e. after GLM is proven to work, not before. This preserves `QWEN_API_KEY` as a live rollback escape hatch for the brief window between merge and verification.

### Q9. Disposition of `qwen-client.ts` and its test file — **RESOLVED: Option A**

Delete both `src/lib/research-engine/engines/qwen-client.ts` and `src/lib/research-engine/engines/__tests__/qwen-client.test.ts` inside the same PR as the GLM swap. No deprecation period; the files have zero consumers after the swap.

### Q10. Verification scope before declaring Phase 3 (Tasks) done — **RESOLVED: Option B+ (with live-API probe)**

Verification gate before declaring the Tasks phase done:

1. `npm run build` passes with zero TypeScript errors.
2. `npx vitest run src/lib/research-engine/engines/__tests__/zai-client.test.ts` reports all cases passing (9 cases from §Requirement 7.1).
3. `getDiagnostics` on all modified files returns zero errors.
4. **Live API probe (new, added after the Qwen post-mortem)**: a one-shot manual script at `scripts/probe-glm.ts` exists that, when run locally with a real `ZAI_API_KEY` in the environment, executes a single `callZai` against a tiny fixture prompt, asserts HTTP 200 + at least 1 search reference + non-empty content, and prints a one-line pass/fail summary. **This probe MUST succeed before the commit is pushed.** This check exists specifically because the Qwen debugging cycle had all 8 unit tests passing while production was broken — mocks passed but live API rejected the request shape.
5. After push + Vercel "Ready": the operator triggers one manual run from `/admin/scheduled-runs`.
6. The operator confirms via SQL that the most recent `scheduled_runs` row has `status='succeeded'`, `b_ok=true`, `b_refs ≥ 3`, `b_err_class IS NULL`.
7. Only after step 6 does the operator delete `QWEN_API_KEY` from Vercel env vars (per §Q8).

## Notes for Phase 2 (Design)

- The design document will need a **before/after file-level diff map** (Moonshot untouched / Qwen client removed / Zai client added / `kimi.ts` model + provider swapped / `loop.ts` dispatcher branch renamed).
- The design document will need a concrete **z.ai request/response shape example** capturing the exact fields the parser will touch.
- The design document will need a **rollback plan** — probably "revert commit + Vercel auto-redeploy + keep `QWEN_API_KEY` live until we confirm GLM stable for 2 weeks" — to avoid locking out the fallback path prematurely.
- The design document must not reopen anything marked "out of scope" in §Introduction.
