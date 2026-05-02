# Design Document

## 1. Overview

This feature replaces Engine B's Stage 1 / Stage 2 research backend from **Alibaba DashScope / Qwen** to **Zhipu AI / GLM via z.ai**. Requirements are frozen in `.kiro/specs/engine-b-glm-replacement/requirements.md` (all 10 open questions resolved).

**Summary**: A new `zai-client.ts` module (structurally modeled on `moonshot-client.ts`) issues a single OpenAI-compatible HTTP call per stage to `https://api.z.ai/api/paas/v4/chat/completions` with three pieces of novelty working together in one request:

1. `thinking: { type: 'disabled' }` — explicit opt-out of GLM-4.6's hybrid thinking mode (avoids the Qwen-class thinking-vs-search incompatibility trap).
2. `response_format: { type: 'json_object' }` + `tools: [{ type: 'web_search', web_search: {...} }]` — combined in the same call (single-call architecture; GLM has no DashScope-style restriction).
3. Tiered per-stage search parameters — Stage 1 uses `search_recency_filter: 'oneWeek'` + `content_size: 'medium'`; Stage 2 uses `search_recency_filter: 'oneMonth'` + `content_size: 'high'`.

**What stays unchanged** (preservation contract, per Requirement 6 & 12): `kimi.ts` filename and `runKimiLoop` export; DB column `scheduled_runs.kimi_output`; `EngineAssembledContent` JSONB shape; 4-stage decomposition (hot-radar-scan → deep-dive → education-mapper → assembler); stage timeouts (240s/240s/60s/90s); Engine A's entire code path; Stage 3 + Stage 4 using OpenRouter against `moonshotai/kimi-k2-0905`; Synthesizer; normalizers; `EngineErrorClass` union.

**The unique insurance against repeating the Qwen debugging cycle** (Q10 resolution): a checked-in live-API probe script at `scripts/probe-glm.ts` that MUST succeed before the commit is pushed. Mocks proved insufficient last time; a 1-shot live call against the real endpoint is the structural guard this time.

## 2. Glossary

Inherits `§Glossary` from `requirements.md` (Engine_B, Zai_Client, Researcher_Model_B, Env_Var_ZAI_Key, Search_Recency_Filter, etc.). Design-level additions:

- **ZAI_ENDPOINT**: the constant `'https://api.z.ai/api/paas/v4/chat/completions'` in `zai-client.ts`.
- **GlmChatMessage**: role-content pair reused from `openrouter-client.ts` (`ChatMessage` type) — same shape Moonshot already consumes; no new type introduced.
- **GlmWebSearchResult**: the shape of one entry inside the top-level `web_search[]` array on a z.ai 200 response. Keys we read: `title`, `link`, `publish_date`, `content`, `media`, `refer`. Keys ignored: `icon`.
- **PROBE_GLM_FIXTURE_PROMPT**: the tiny hardcoded prompt used by `scripts/probe-glm.ts`. Must ask for a search with a verifiable recency constraint so we can confirm the request-body shape was accepted end-to-end.
- **DASHSCOPE_API_KEY (legacy)**: the *actual* env var name currently used in `generate-report.ts` — despite requirements.md referring to "QWEN_API_KEY", the code reads `process.env.DASHSCOPE_API_KEY`. This spec removes that read and introduces `process.env.ZAI_API_KEY`. The rollback / operator-action wording in Q8 still applies logically: whatever key *currently* holds the Alibaba credential in Vercel (named `DASHSCOPE_API_KEY`) is the one the operator deletes post-verification. See §8.

## 3. Architecture / Component Diagram

```
┌─────────────────┐     ┌──────────┐     ┌─────────────────┐
│ Inngest cron    │────▶│ loop.ts  │────▶│ callZai  (NEW)  │────▶ api.z.ai/api/paas/v4/chat/completions
│ generate-report │     │ dispatch │     │ zai-client.ts   │       (glm-4.6, single HTTP call per stage)
└─────────────────┘     └──────────┘     └─────────────────┘
                              │
                              ├────▶ callMoonshot      (UNCHANGED — Engine A, Stage 1/2)
                              ├────▶ callOpenRouter    (UNCHANGED — all engines, Stage 3/4)
                              └────▶ callQwen          (DELETED)
```

Dispatch in `loop.ts` via the `researcherProvider` discriminator:

```
researcherProvider === 'moonshot' → callMoonshot         (Engine A)
researcherProvider === 'zai'      → callZai              (Engine B, NEW)
researcherProvider === 'openrouter' → callOpenRouter     (legacy path, retained)
```

Engine B (`kimi.ts`) sets `researcherProvider: 'zai'` in its EngineLoopConfig; `loop.ts` routes accordingly.

### Flow for one Stage 1 call (Engine B hot-radar-scan)

```
kimi.ts runKimiLoop
  → loop.ts runEngineLoop
    → stage1-hot-radar step
      → callResearcher(...) sees researcherProvider='zai'
        → callZai({ model: 'glm-4.6', messages, apiKey: ZAI_API_KEY,
                    timeoutMs: 240_000, jsonMode: true,
                    searchRecency: 'oneWeek', contentSize: 'medium',
                    errorContext: { engine:'kimi', stage:'hot-radar-scan' } })
          → fetch POST ZAI_ENDPOINT
            body: { model, messages, thinking:{type:'disabled'},
                    response_format:{type:'json_object'},
                    tools:[{type:'web_search',
                            web_search:{enable:'True', search_result:'True',
                                        search_recency_filter:'oneWeek',
                                        content_size:'medium'}}],
                    temperature:0.3, max_tokens:8192 }
          → 200 response
            { choices:[{message:{content:"<JSON>"}}], web_search:[...] }
          → parse choices[0].message.content as JSON (stripCodeFences first)
          → extract web_search[] → EngineSearchReference[]
          → return { ok:true, data, rawContent, searchReferences, searchCount }
    → normalizeHotRadar(data) — unchanged
    → trace.hotRadar = normalized; trace.searchReferences += refs
```

## 4. File-Level Diff Map

| File | Change type | Details |
|---|---|---|
| `src/lib/research-engine/engines/zai-client.ts` | **CREATE** | New module, ~300 lines. Mirrors `moonshot-client.ts` module layout (exports `callZai`, shared helpers `classifyHttpStatus` / `truncate` / `stripCodeFences` / dedupe). Single-call architecture — no tool_calls loop. |
| `src/lib/research-engine/engines/__tests__/zai-client.test.ts` | **CREATE** | 9 cases — see §9. Uses `vi.stubGlobal('fetch', ...)` like the Qwen test does. |
| `src/lib/research-engine/engines/kimi.ts` | MODIFY | `DEFAULT_RESEARCHER_MODEL` → `'glm-4.6'`. `researcherProvider` → `'zai'`. `KimiLoopInput.qwenApiKey` → `zaiApiKey`. Docblock rewritten: history note that 2026-05 switched to Qwen direct, 2026-05 (this PR) swapped Qwen→Zhipu GLM; rationale paragraphs reference `glm-4.6` tool-use positioning and single-call architecture. Stage timeouts unchanged. |
| `src/lib/research-engine/engines/loop.ts` | MODIFY | `ResearcherProvider` union: `'qwen'` → `'zai'`. `EngineLoopConfig.qwenApiKey` → `zaiApiKey` (optional). Dispatcher branch `if (config.researcherProvider === 'qwen')` → `'zai'`, inner body calls `callZai` instead of `callQwen`. Pass `searchRecency` + `contentSize` to `callZai` based on `p.stage`. Remove `import { callQwen } from './qwen-client'`; add `import { callZai } from './zai-client'`. |
| `src/lib/research-engine/engines/qwen-client.ts` | **DELETE** | Zero consumers after the `loop.ts` edit. |
| `src/lib/research-engine/engines/__tests__/qwen-client.test.ts` | **DELETE** | Paired with the module. |
| `src/lib/inngest/functions/generate-report.ts` | MODIFY | Replace lines that read `process.env.DASHSCOPE_API_KEY` with `process.env.ZAI_API_KEY`. Rename local `const qwenApiKey` → `zaiApiKey`. Update the error message from `'DASHSCOPE_API_KEY is not set — Engine B requires direct Alibaba Qwen access for enable_search'` to `'ZAI_API_KEY is not set — Engine B requires Zhipu GLM access for web_search'`. In the `runKimiLoop` call, rename `qwenApiKey: config.qwenApiKey` → `zaiApiKey: config.zaiApiKey`. |
| `src/lib/research-engine/index.ts` | MODIFY | In the `runKimiLoop` call inside `run()`: rename `qwenApiKey: input.qwenApiKey ?? ''` → `zaiApiKey: input.zaiApiKey ?? ''`. |
| `src/types/scheduled-runs.ts` | MODIFY | Two targeted edits: (a) `EngineSearchReference.provider` union `'moonshot' \| 'qwen' \| 'openrouter-exa'` → `'moonshot' \| 'zai' \| 'openrouter-exa'` (requirements 4.3 & preservation of historical rows covered below). (b) `ResearchEngineInput.qwenApiKey?: string` → `zaiApiKey?: string`, doc comment updated to reference Zhipu GLM. |
| `scripts/probe-glm.ts` | **CREATE** | ~50-line live-API probe. See §9. |
| `.env.example` | N/A | File does not exist in this repo — skip. Env var setup lives in Vercel dashboard and project README (which we do not modify here; the requirements.md §5.5 note is sufficient). |

**Historical-row backward compatibility note for `provider` rename**: The `EngineSearchReference.provider` field is the only place `'qwen'` appears as a runtime discriminator in the JSONB. Existing `scheduled_runs` rows from Qwen-era runs have `provider: 'qwen'` stored in their `kimi_output.trace.searchReferences[]`. Per Requirement 12.10, the Report UI must render pre-swap JSONB without error. TypeScript's union narrowing on a JSON value read from DB is a *read-time* concern: if the UI ever `switch`es on `provider`, it will hit the string `'qwen'` which is no longer in the union. **Resolution**: the UI consumers of `EngineSearchReference` already treat `provider` as display-only metadata (no switch/case) — confirmed by the Qwen-era rollout. TypeScript strictness against the old value only bites *at compile* if we narrow the type, which we don't. The `provider` string survives DB round-trip as an untyped JSONB string. No migration needed.

## 5. `zai-client.ts` Interface and Request Shape

### Public function signature

```typescript
export async function callZai<T = unknown>(
  params: ZaiCallParams
): Promise<ZaiResult<T>>
```

### `ZaiCallParams`

```typescript
export interface ZaiCallParams {
  /** GLM model id, e.g. 'glm-4.6'. */
  model: string;
  messages: ChatMessage[]; // reused from openrouter-client.ts
  apiKey: string;
  /** Hard cap on the single HTTP call. Stage-level (240s / 60s / 90s). */
  timeoutMs: number;
  /** If true, include `response_format: { type: 'json_object' }`. */
  jsonMode?: boolean;
  /**
   * Passed through to the web_search tool's search_recency_filter field.
   * Undefined → omit field (GLM default: noLimit).
   */
  searchRecency?: 'noLimit' | 'oneDay' | 'oneWeek' | 'oneMonth' | 'oneYear';
  /**
   * Passed through to the web_search tool's content_size field.
   * Undefined → omit field (GLM default: medium).
   */
  contentSize?: 'low' | 'medium' | 'high';
  errorContext: {
    engine: 'gemini' | 'kimi' | 'synthesizer';
    stage?: LoopStage;
    topicIndex?: number;
  };
}
```

### `ZaiResult<T>` discriminated union

```typescript
export type ZaiResult<T> =
  | {
      ok: true;
      data: T;                              // parsed JSON from choices[0].message.content
      rawContent: string;                   // the content string post stripCodeFences
      searchReferences: EngineSearchReference[]; // deduped by URL
      searchCount: number;                  // web_search[].length
    }
  | { ok: false; error: EngineError };
```

### Outgoing HTTP request body (Stage 1 example, hot-radar-scan)

```json
{
  "model": "glm-4.6",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user",   "content": "请按 system 指令做一次综合 web search，输出 JSON。" }
  ],
  "thinking": { "type": "disabled" },
  "response_format": { "type": "json_object" },
  "tools": [
    {
      "type": "web_search",
      "web_search": {
        "enable": "True",
        "search_result": "True",
        "search_recency_filter": "oneWeek",
        "content_size": "medium"
      }
    }
  ],
  "temperature": 0.3,
  "max_tokens": 8192
}
```

Rationale:

- `thinking: { type: 'disabled' }` — explicit opt-out of GLM-4.6's hybrid thinking mode. The Qwen cycle showed that relying on "docs say default off" is unsafe; explicit is free insurance.
- `response_format: { type: 'json_object' }` — Principle 2: API-level constraint over prompt-hope.
- `enable: 'True'` and `search_result: 'True'` as *strings* per z.ai convention (these are documented as `"True"` / `"False"` strings, not booleans, in their OpenAPI spec). The probe script verifies this empirically before we commit.
- `temperature: 0.3` — aligns with Moonshot/OpenRouter calls' deterministic research profile.
- `max_tokens: 8192` — matches Moonshot client's effective envelope and covers our Stage-1/2 JSON outputs (top-5 topics × 2 modules + tool_feedback).

### Incoming HTTP response body (what we parse)

```json
{
  "id": "...",
  "model": "glm-4.6",
  "created": 1740000000,
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "message": {
        "role": "assistant",
        "content": "{ ...strict-JSON-string-per-prompt... }"
      }
    }
  ],
  "web_search": [
    {
      "title": "...",
      "link":  "https://...",
      "publish_date": "2026-04-28",
      "content": "...long snippet body...",
      "media": "Sohu",
      "refer": "ref_1",
      "icon":  "https://..."
    }
  ],
  "usage": { "prompt_tokens": ..., "completion_tokens": ..., "total_tokens": ... }
}
```

Parser touches these fields only:

| Field path | Used for |
|---|---|
| `choices[0].finish_reason` | Must equal `'stop'` (or non-`'tool_calls'`); terminal turn check. |
| `choices[0].message.content` | `stripCodeFences` → `JSON.parse` → `data: T`. |
| `web_search[]` (top-level array) | Each entry → `EngineSearchReference`. |
| `web_search[i].link` | → `EngineSearchReference.url` (note z.ai uses `link`, not `url`). |
| `web_search[i].title` | → `EngineSearchReference.title`. |
| `web_search[i].publish_date` | → `EngineSearchReference.published_date`. Empty string `""` → `undefined`. |
| `web_search[i].content` | → `EngineSearchReference.snippet` (truncated to 200 chars). |
| `web_search.length` | → `searchCount`. |

All other fields ignored.

### Parser notes

- If `web_search` is missing/empty → `searchReferences = []`, `searchCount = 0` (not an error; hot-radar prompt may produce an answer from model memory if the search tool returned nothing — Requirement 4.4 guards against this at Integration time via `b_refs ≥ 3`).
- `provider: 'zai'` is stamped on every extracted reference.
- Dedup by `link` (→ `url`) — same pattern as Moonshot.
- No separate "usage.plugins.search.count" probe (Qwen-specific). `searchCount = web_search.length` is the sole source.

## 6. Error Handling Table

Per Requirement 2 + the existing `EngineErrorClass` union (unchanged).

| HTTP status / condition | `errorClass` | Retryable? | Notes |
|---|---|---|---|
| 401 | `CreditsExhausted` | No | Bad or missing ZAI_API_KEY. |
| 402 | `CreditsExhausted` | No | Billing failure / insufficient credits. |
| 403 | `CreditsExhausted` | No | Key revoked or region-blocked. |
| 429 | `RateLimited` | No (return to caller) | Caller may escalate; Engine A still runs. |
| 5xx | `ServerError` | Yes, ×2 with exponential backoff (500ms, 1000ms) | Same budget as `qwen-client.ts` (`MAX_RETRIES = 2`). |
| fetch throws `AbortError` | `TimeoutError` | No | Caller `timeoutMs` exhausted. |
| fetch throws other `Error` | `NetworkError` | Yes, ×2 with same backoff | Cross-border US→CN TLS/DNS flake. |
| 200, no `choices[0]` | `MalformedResponse` | No | |
| 200, `choices[0].message.content` not a string | `MalformedResponse` | No | |
| 200, content present but `JSON.parse` throws after `stripCodeFences` | `MalformedResponse` | No | |
| 200, `finish_reason === 'tool_calls'` | `MalformedResponse` | No | GLM single-call design contract does not expect further tool rounds; if it ever emits one, treat as schema mismatch. |

`EngineError` is populated with `...errorContext` so the downstream trace can reconstruct which engine / stage / topic the failure belongs to.

## 7. Key Design Decisions and Rationale

### 7.1 Single-call over two-step (Q2 resolution, satisfies Requirement 1.2 + 1.3)

GLM's `web_search` tool does not restrict `response_format` in the same call (verified in z.ai docs). One HTTP round-trip per stage is the simplest correct thing. Two-step (the Qwen workaround) would double latency and token spend for zero benefit. Single-call also eliminates the "Step-2 sees mangled Step-1 summary" failure mode that complicated `qwen-client.ts`.

### 7.2 `thinking: { type: 'disabled' }` explicitly set (Requirement 1.3, Risk 10.3 mitigation)

GLM-4.6 is a hybrid thinking model. Per z.ai docs, thinking is default-*on* when not specified. Combined with our non-streaming + JSON + search request, the safest posture is to always set `thinking: { type: 'disabled' }` — we don't need chain-of-thought tokens for Stage 1/2 (the prompts already decompose the task), and paying for thinking tokens is pure cost without benefit. The Qwen cycle proved that "defaults documented somewhere" is not the same as "defaults observed at runtime"; always explicit.

### 7.3 Tiered `search_recency_filter` (Requirement 4.1, 4.2; Q5 resolution)

- **Stage 1 = `oneWeek`**: hot-radar is about *what's burning right now*. Last-week freshness maximizes the chance that `b_refs` cites posts inside the run's `coverage_window`.
- **Stage 2 = `oneMonth`**: deep-dive needs background material (policy explainers, case threads that may predate the hot spike) to build the narrative. `oneMonth` widens the lens without going stale.

These are hardcoded constants in `loop.ts` for MVP (§Q5). A future spec can promote them to DB-editable columns on `schedule_configs`.

### 7.4 Tiered `content_size` (Requirement 1.3, Q6 resolution)

- **Stage 1 = `medium`**: hot-radar output is a ranked list with short `seller_discussion` + `initial_evidence`. Snippet-level content is sufficient; asking for `high` would inflate token cost on a ranking task.
- **Stage 2 = `high`**: deep-dive narrates with quotes and case detail. Richer source text translates directly to better `quotes` / `cases` extraction.

### 7.5 Live-API probe script (Requirement 7 extension, Q10 resolution)

The Qwen debugging cycle produced a precise lesson: **8 unit tests passed, live production failed** because mocks matched a shape the real API rejected. Unit tests prove the client is internally consistent; they do not prove the request body is accepted by the remote service. A one-shot probe that actually hits `api.z.ai` with a real key closes that gap for negligible cost (one API call per push, ~10 tokens of input).

The probe is checked in as `scripts/probe-glm.ts` and the Tasks phase will require it to succeed before push.

### 7.6 Why we rename `qwenApiKey`→`zaiApiKey` in 4 files instead of aliasing

Keeping the legacy name as an alias would leak "qwen" conceptually into every future reader of `ResearchEngineInput`, `EngineLoopConfig`, and `KimiLoopInput`. The rename is mechanical (the type-checker catches every callsite) and consistent with Q1 / Q3 / Q9 spirit (atomic swap, no deprecation period). Four touchpoints: `scheduled-runs.ts`, `loop.ts`, `kimi.ts`, `research-engine/index.ts`, `inngest/functions/generate-report.ts`.

### 7.7 `EngineSearchReference.provider` union gains `'zai'`, loses `'qwen'`

This is the only runtime discriminator that carries the provider name into persistent state. Historical rows stored `'qwen'`; new rows will store `'zai'`. Per §4 note, no UI code switches on this value, so backward compat is preserved at read-time. If a future feature ever wants to narrow by provider, it can add `'qwen'` back to the union (as a historical-only value) — out of scope here.

## 8. Rollback Plan

Three tiers, ordered by blast radius:

### Tier 1 — Immediate (code revert, env still has legacy key)

1. `git revert <merge-sha>` → push to main → Vercel auto-redeploys previous bundle.
2. Because Q8 kept `DASHSCOPE_API_KEY` (the env var the legacy Qwen code path reads) live in Vercel through the verification window, the reverted bundle finds its credential and Engine B goes back to its *previous-broken-Qwen* behavior — still emitting `b_ok=false` at 400 from DashScope, but the rest of the pipeline (Engine A + Synthesizer single-source fallback) continues per Requirement 9.3.
3. Timing: ~2 min (Vercel deploy) + 0 min operator action.

### Tier 2 — Stop Engine B without reverting (if GLM has odd behavior we want to debug on a live branch)

1. In Vercel → Environment Variables → set `ZAI_API_KEY` = empty string → Redeploy.
2. `runKimiLoop` fails fast at the `ZAI_API_KEY is missing` check (Requirement 5.2) before any HTTP call.
3. Synthesizer runs on Engine A alone per Requirement 9.3; reports are single-source until we re-populate the key.
4. Timing: ~1 min (env var save + redeploy).

### Tier 3 — Full un-do (restore Qwen code)

1. `git revert` the merge commit → `qwen-client.ts` + test + all `qwenApiKey` plumbing restored.
2. `DASHSCOPE_API_KEY` still in Vercel → Engine B returns to "qwen 400" baseline.
3. Engine B state *before* Qwen (OpenRouter `:online`) is **not** restorable from this revert alone — that code was removed in an earlier spec (2026-05-01 AM Qwen-direct PR). Restoring it would require a second revert further back in history.
4. Timing: ~2 min.

### Operator action after successful verification (Q8)

Only after the verification gate (§9) passes on a real production run does the operator delete `DASHSCOPE_API_KEY` from Vercel. This preserves Tier 1 rollback for the verification window.

## 9. Testing Strategy

### 9.1 Unit tests (`zai-client.test.ts`) — 9 cases from Requirement 7.1

| # | Case name | What it proves |
|---|---|---|
| 1 | `successful JSON parse` | Happy path: 200 + strict-JSON content + `web_search[]` returns `ok:true` with parsed `data`, refs, and `searchCount` matching `web_search.length`. |
| 2 | `web_search tool call round-trip` | Request body includes `tools: [{ type:'web_search', web_search:{...} }]` with `enable:'True'` / `search_result:'True'`. Response with top-level `web_search` array parses into `EngineSearchReference[]` with `provider:'zai'` and `url` mapped from `link`. |
| 3 | `search_recency_filter is forwarded` | Calling with `searchRecency:'oneMonth'` causes outgoing body's `tools[0].web_search.search_recency_filter === 'oneMonth'`. Same for `contentSize`. |
| 4 | `401 classified as CreditsExhausted without retry` | `fetch` mock returns 401 → result is `{ ok:false, error:{ errorClass:'CreditsExhausted', httpStatus:401 } }`. Assert `fetchMock` called exactly once (no retry). |
| 5 | `429 classified as RateLimited` | `fetch` mock returns 429 → `errorClass:'RateLimited'`, called once. |
| 6 | `transient 500 retried once then succeeds` | First call 500, second call 200 JSON → `ok:true`, `fetchMock` called 2 times. |
| 7 | `malformed response body classified as MalformedResponse` | 200 but `message.content` is `"not valid json"` → `errorClass:'MalformedResponse'`. |
| 8 | `abort classified as TimeoutError` | `fetchMock` throws `new DOMException('aborted', 'AbortError')` → `errorClass:'TimeoutError'`. |
| 9 | `search references deduped by URL` | Response with 3 entries where two share a `link` → result has 2 refs. |

All 9 use `vi.stubGlobal('fetch', fetchMock)` pattern, mirroring `qwen-client.test.ts`.

### 9.2 Live-API probe script (`scripts/probe-glm.ts`)

Shape:

- Reads `process.env.ZAI_API_KEY`. Exits non-zero with clear message if missing.
- Constructs a minimal `callZai` invocation:
  - `model: 'glm-4.6'`
  - `messages: [{ role:'user', content:'搜索最近一周中国跨境电商合规政策热点，返回 JSON 形如 {topics: [{topic, keywords, voice_volume}]}，最多 3 条。' }]`
  - `timeoutMs: 60_000`
  - `jsonMode: true`
  - `searchRecency: 'oneWeek'`
  - `contentSize: 'medium'`
  - `errorContext: { engine:'kimi', stage:'hot-radar-scan' }`
- Asserts three things on the result:
  1. `result.ok === true`
  2. `result.searchReferences.length >= 1`
  3. `typeof result.data === 'object' && result.data !== null`
- Prints one line: `PROBE PASS: glm-4.6 single-call web_search + json_object works; got N refs` or `PROBE FAIL: <error-class>: <message>`.
- Process exit code: 0 on pass, 1 on fail.
- Invocation documented in `tasks.md`: `ZAI_API_KEY=sk-xxxxx npx tsx scripts/probe-glm.ts` (project already depends on `tsx` transitively via Next; if not available we use `ts-node` or `esbuild-register` — Tasks will finalize).

### 9.3 Post-deploy integration (manual, from Requirement 8.1 and Q10)

1. Operator triggers one manual run from `/admin/scheduled-runs`.
2. Operator runs in Supabase SQL Editor:
   ```sql
   SELECT id, status, b_ok, b_refs, b_error_class, triggered_at
   FROM scheduled_runs
   ORDER BY triggered_at DESC
   LIMIT 1;
   ```
3. Gate: row MUST show `status='succeeded' AND b_ok=true AND b_refs >= 3 AND b_error_class IS NULL`.
4. If the gate passes, operator deletes `DASHSCOPE_API_KEY` from Vercel (Tier 1 rollback no longer needed).

## 10. Known Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| GLM `web_search` response shape differs from docs example | Medium | `scripts/probe-glm.ts` catches before push. Parser is defensive (optional chaining, type guards). |
| GLM rate limits hit during parallel Stage 2 (up to 6 concurrent topics: 2 modules × top-3) | Medium | `callZai` retry handles 429 once; beyond that, 429 bubbles to caller and the affected topic's `DeepDiveOutput` falls back to `normalizeDeepDive(null, ...)` per existing `loop.ts` partial-failure policy. If observed in practice, a follow-up spec can add a dispatch-layer semaphore. |
| `thinking: { type: 'disabled' }` not actually respected by glm-4.6 at runtime | Low | Docs are explicit about the knob; probe script empirically catches a surprise 400 or token blow-up before push. |
| Single-call fails to produce valid JSON with tool-calling in the same turn | Low-medium | Parser uses `stripCodeFences` + `JSON.parse` with try/catch; returns `MalformedResponse` cleanly. The `response_format: json_object` API constraint (Principle 2) is the structural guarantee. If empirically the failure rate is >5%, the fallback is a two-step flow (same pattern `qwen-client.ts` uses) — out of scope here, documented as a follow-up path. |
| Cross-border latency between Vercel US and api.z.ai (Beijing-based) | Medium | 240s stage timeout (same as Moonshot from Vercel US → api.moonshot.cn which we already prove is enough). Retry budget ×2 for NetworkError covers TLS/DNS flakes. |
| z.ai service outage during the first triggered run | Low | Engine A (Moonshot) still completes; Synthesizer Requirement 9.3 fallback produces a single-source report. Scheduled run still succeeds. |
| `web_search[].link` field changes name, empty `publish_date` breaks something downstream | Low | Parser treats `link` as the URL key (matches docs); empty `publish_date` → `undefined`, which the existing `EngineSearchReference.published_date?` handles. |
| Historical `scheduled_runs.kimi_output` rows store `provider:'qwen'` which is no longer in the union | Low | §4 note: UI is display-only, no type narrowing — historical rendering unaffected. Covered by Requirement 12.10. |

## 11. Open Items for Phase 3 (Tasks)

Only low-priority items deferred, no design decisions reopened:

- **Exact `.env` hint in `generate-report.ts` error message**: wording like `'ZAI_API_KEY is not set — Engine B requires Zhipu GLM access for web_search'` finalized in Tasks.
- **Choice of `tsx` vs `ts-node` vs `esbuild-register` to run `probe-glm.ts`**: pick based on what's already in `package.json` during Task execution.
- **Dev-level comments** in `zai-client.ts` that cite the docs URL (`https://docs.z.ai/guides/tools/web-search`) and the `glm-4.6` positioning rationale — copy paste pattern from Moonshot client.
- **Test file imports**: whether to share `stripCodeFences` helper import from `openrouter-client.ts` (unchanged re-use) or inline — pick lightest touch.

No design decisions remain open. Ready for Tasks phase.
