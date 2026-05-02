# Qwen Engine Thinking-Mode Crash — Bugfix Design

## Overview

Engine B (Alibaba Qwen via DashScope) crashes at Stage 1 `hot-radar-scan` with HTTP 400 `InternalError.Algo.InvalidParameter` (_"Non-streaming mode does not support Web Search in thinking mode"_). The deployed model `qwen3.5-plus` defaults to thinking-mode ON, which DashScope refuses to combine with `enable_search=true` in non-streaming mode.

**Fix (one line, approved minimum scope)**: change `DEFAULT_RESEARCHER_MODEL` in `src/lib/research-engine/engines/kimi.ts` from the uncommitted working-tree value `'qwen-plus'` to **`'qwen3-max'`**.

Why `qwen3-max` (and not `qwen-plus`, which was the first-draft swap):

- Per Alibaba's official DashScope docs ([deep-thinking](https://help.aliyun.com/zh/model-studio/deep-thinking), [web-search](https://help.aliyun.com/zh/model-studio/web-search)):
  1. `qwen3-max` defaults to thinking mode **OFF** — satisfies the API's `enable_search + non-streaming` constraint.
  2. `qwen3-max` is the **only** Qwen series that supports `search_options.search_strategy: 'agent'`. On other models (including `qwen-plus`) the agent value is silently rejected or downgraded to `turbo` (single-round search).
- The existing `callQwen` client already sends `search_strategy: 'agent'` on every Stage 1 and Stage 2 call. Using any model other than `qwen3-max` means the agent strategy we configured silently loses its effect. `qwen3-max` is the unique model that both (a) avoids the thinking-mode crash and (b) actually executes the multi-round agent search we already asked for.

Everything else — two-step flow in `qwen-client.ts`, retry policy, timeouts, Engine A (Moonshot), Stage 3/4 OpenRouter path, the 8 existing unit tests — stays untouched. This is a string-literal swap with a supporting doc-comment rewrite. No schema changes, no new tests, no migration, no Inngest resync, no env var changes.

This spec follows `debugging-discipline.md` Rule 6 (minimum fix) after four previous expand-scope attempts each hit a new constraint. It deliberately defers freshness, date-hint injection, schema additions, prompt changes, and Engine A symmetry to a separate follow-up spec (see §Deferred Work).

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — DashScope receives `enable_search=true` + `stream=false` + a model whose default is thinking-mode-ON.
- **Property (P)**: Desired behavior when Engine B Stage 1/2 runs — DashScope accepts the request (HTTP 200), executes multi-round agent search, and returns `search_info.search_results` with ≥ 1 entry.
- **Preservation**: Every call path that is not the Engine-B thinking-mode-on case remains byte-identical in behavior — Engine A, Stage 3/4, `qwen-client.ts` two-step architecture, retry/error classification, and the 8 existing unit tests.
- **`DEFAULT_RESEARCHER_MODEL`**: The single string constant in `src/lib/research-engine/engines/kimi.ts` (line 54) that selects Engine B's Stage 1/2 researcher model on DashScope. The only value this spec changes.
- **`callQwen`**: The two-step DashScope client in `src/lib/research-engine/engines/qwen-client.ts`. Step 1 enables search (no `response_format`); Step 2 reformats Step-1 output into strict JSON (no `enable_search`). Not modified by this spec.
- **`search_strategy: 'agent'`**: DashScope's multi-round agentic search mode. Per Alibaba docs, supported **only** on the `qwen3-max` series; other models silently fall back to `turbo`. Already hard-coded into `qwen-client.ts` line ~96.
- **Engine A**: Moonshot pipeline via `runGeminiLoop` → `callMoonshot`. Never touches DashScope.
- **Engine B**: Qwen pipeline via `runKimiLoop` → `callQwen`. The only consumer of DashScope in the codebase.

## Bug Details

### Bug Condition

The bug manifests when DashScope's `/chat/completions` endpoint receives a non-streaming request with `enable_search=true` and a model whose default is thinking-mode ON. DashScope rejects the request with HTTP 400 `InternalError.Algo.InvalidParameter` (_"Non-streaming mode does not support Web Search in thinking mode"_). Because `callQwen` is always non-streaming and always sets `enable_search=true` in Step 1, the bug is fully determined by the choice of model.

**Formal Specification:**

```
FUNCTION isBugCondition(X)
  INPUT:  X = { model: string,
                enable_search: boolean,
                stream: boolean }
          // i.e. the HTTP body sent to DashScope /chat/completions
  OUTPUT: boolean

  RETURN X.enable_search = true
     AND X.stream = false
     AND modelDefaultsToThinkingOn(X.model)
END FUNCTION

FUNCTION modelDefaultsToThinkingOn(model)
  // Per https://help.aliyun.com/zh/model-studio/deep-thinking
  // "默认开启思考模式" series:
  RETURN model STARTSWITH 'qwen3.5-'        // qwen3.5-plus, qwen3.5-flash, ...
      OR model STARTSWITH 'qwen3.6-'        // qwen3.6-plus, qwen3.6-max-preview, ...
      OR model IN {'qwq-plus', 'qwq-32b'}   // "仅思考" series
  // "默认不开启思考模式" (safe):
  //   qwen3-max, qwen3-max-latest, qwen3-max-2025-*
  //   qwen-plus, qwen-plus-latest, qwen-plus-2025-04-28+
  //   qwen-flash, qwen-turbo
END FUNCTION
```

### Examples

- **Currently in production (HEAD = `9fbef2b`)**:
  `X = { model: 'qwen3.5-plus', enable_search: true, stream: false }` → `isBugCondition(X) = true` → DashScope returns HTTP 400 → every scheduled run records `b_ok=false, b_refs=0, b_error_class='ServerError'`.

- **Uncommitted working-tree (first-draft fix)**:
  `X = { model: 'qwen-plus', enable_search: true, stream: false }` → `isBugCondition(X) = false` → HTTP 400 stops. But `search_strategy='agent'` is silently downgraded to `turbo` (single-round), costing us the multi-round deep search Engine B is supposed to provide.

- **This spec's approved fix**:
  `X = { model: 'qwen3-max', enable_search: true, stream: false }` → `isBugCondition(X) = false` AND `search_strategy='agent'` runs natively → HTTP 200 + real multi-round agent search.

- **Edge case — the `callQwen` Step 2 call** is structurally immune regardless of model:
  `X = { model: '<any>', enable_search: false, stream: false }` → `isBugCondition(X) = false` always (because `enable_search` is false). Step 2's purpose is exactly to decouple `response_format: json_object` from `enable_search`, which DashScope also forbids combining.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

1. **Engine A (Moonshot) is byte-identical**: `runGeminiLoop`, `callMoonshot`, and the `kimi-k2.6` model choice are untouched. Engine A never calls DashScope, so no Qwen change can affect it.
2. **Two-step flow in `qwen-client.ts` is byte-identical**: Step 1 sends `enable_search=true`, `search_options={ search_strategy: 'agent', enable_source: true }`, and no `response_format`. Step 2 sends `response_format={ type: 'json_object' }` and no `enable_search`. Same request shape as before; only the model string in the URL-body changes.
3. **Retry and error classification are byte-identical**: `MAX_RETRIES=2`, `BACKOFF_BASE_MS=500`, 4xx = permanent, 5xx/network = retryable, 401/402/403 → `CreditsExhausted`, 429 → `RateLimited`.
4. **Timeouts are byte-identical**: Stage 1/2 still 240 000 ms, Stage 3 still 60 000 ms, Stage 4 still 90 000 ms.
5. **Stage 3/4 OpenRouter path is byte-identical**: `DEFAULT_MODEL = 'moonshotai/kimi-k2-0905'` and `callOpenRouter` for `education-mapper` and `assembler`.
6. **Search reference extraction is byte-identical**: Both `choices[0].message.search_info.search_results` (OpenAI-compat shape) and `output.search_info.search_results` (native DashScope shape) are probed; URLs are deduped.
7. **The 8 existing unit tests in `__tests__/qwen-client.test.ts` keep passing with zero edits**. They already use `'qwen3-max'` as the fixture model id, so the production default now aligns with what the tests simulate. The client never branches on model id — all assertions are about request-body shape and response handling, independent of the model string.

**Scope:**

Every call path that does **not** satisfy `isBugCondition(X) = true` must behave identically to the pre-fix code. Concretely this includes:
- All Moonshot calls (Engine A Stage 1/2).
- All OpenRouter calls (Stage 3/4, synthesizer, any other consumer).
- The Step 2 call inside `callQwen` (has `enable_search=false` — bug condition is impossible).
- Unit-test mocked `fetch` calls (no live DashScope — no API contract to violate).
- Any future call path that legitimately needs a non-search Qwen completion (none exists today, but the principle is preserved).

## Hypothesized Root Cause

The root cause is already **confirmed** (not hypothesized) by:
1. The exact HTTP 400 message from DashScope in production logs: _"Non-streaming mode does not support Web Search in thinking mode"_.
2. Alibaba's official docs stating `qwen3.5-plus` is in the _"默认开启思考模式"_ series.
3. `callQwen` structurally never streams (uses `await fetch(...)`, not `ReadableStream`) and always sets `enable_search=true` in Step 1.

Three intersecting factors produce the bug:

1. **Thinking mode default by model**: DashScope attaches an implicit `enable_thinking=true` to every request for thinking-on-default models. `callQwen` does not override via `extra_body.enable_thinking=false`, so the flag flows through unchanged.

2. **Non-streaming HTTP client**: `callQwen` uses standard `fetch` with a JSON response body, not Server-Sent Events. This is an intentional design choice for Vercel serverless compatibility.

3. **API-level constraint**: DashScope documents that `enable_search` + thinking-mode + non-streaming is an unsupported 3-way combination. The error message is deterministic and immediate — it's a pre-validation failure, not a runtime failure.

**Why the fix is a model swap rather than a parameter addition**: Adding `extra_body.enable_thinking=false` would also unblock the bug, but it adds a surface that varies between DashScope's OpenAI-compat and native endpoints, and it doesn't solve the second problem — that `search_strategy: 'agent'` only runs on `qwen3-max`. Swapping to `qwen3-max` fixes both with zero new code.

## Correctness Properties

Property 1: Bug Condition — Qwen3-Max bypasses thinking-mode rejection

_For any_ production invocation of `callQwen` where the input satisfies the bug condition (`enable_search=true ∧ stream=false ∧ modelDefaultsToThinkingOn(model)`), the fixed code SHALL send a model that does NOT satisfy `modelDefaultsToThinkingOn()`, so DashScope accepts the request (HTTP 200), the Step-1 response contains `search_info.search_results` populated by multi-round agent search (`search_strategy='agent'` natively supported on `qwen3-max`), and `callQwen` returns `{ ok: true, searchReferences.length ≥ 1 }` for any realistic hot-radar query.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation — No other call path changes behavior

_For any_ call path where the bug condition does NOT hold (Engine A Moonshot calls, OpenRouter calls for Stage 3/4, the Step-2 structure call inside `callQwen` which has `enable_search=false`, or the unit-test mocked `fetch` calls), the fixed code SHALL produce exactly the same request shape, retry behavior, error classification, timeout budget, and response handling as the original code. The only observable diff in the fixed codebase is the single string literal `'qwen3-max'` in place of `'qwen3.5-plus'` in `DEFAULT_RESEARCHER_MODEL` of `kimi.ts`, plus its surrounding doc-comment block.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

Single-file change. All code outside this file is untouched.

**File**: `src/lib/research-engine/engines/kimi.ts`

**Function / Symbol**: `DEFAULT_RESEARCHER_MODEL` (module-level `const`, line 54) + the doc-comment block above it.

**Before** (uncommitted working-tree state, the `qwen-plus` first-draft swap):

```ts
/**
 * Engine B researcher model — Alibaba DashScope direct, enable_search enabled.
 *
 * Why qwen-plus (not qwen3-max or qwen3.5-plus):
 *   Both qwen3-max and qwen3.5-plus default to "thinking mode" ON. Alibaba's
 *   API rejects the combination:
 *     enable_search + non-streaming + thinking mode
 *   with a specific 400:
 *     'Non-streaming mode does not support Web Search in thinking mode'
 *
 *   qwen-plus (Qwen3 Plus series, the non-3.5 variant) defaults to thinking
 *   mode OFF per Alibaba's official docs:
 *     "千问Plus系列（混合思考模式，默认不开启思考模式）:
 *      qwen-plus, qwen-plus-latest, qwen-plus-2025-04-28"
 *
 *   For our 'search + top-N extraction' task, qwen-plus is more than
 *   sufficient; we don't need thinking-tier reasoning, and its default-off
 *   behavior makes enable_search work without any extra_body.enable_thinking
 *   parameter.
 *
 *   https://help.aliyun.com/zh/model-studio/deep-thinking
 */
const DEFAULT_RESEARCHER_MODEL = 'qwen-plus';
```

**After** (this spec's fix):

```ts
/**
 * Engine B researcher model — Alibaba DashScope direct, enable_search enabled.
 *
 * Why qwen3-max (not qwen-plus, not qwen3.5-plus):
 *
 *   1. Thinking-mode default. Alibaba's API rejects the 3-way combination
 *      `enable_search + non-streaming + thinking-mode-on` with HTTP 400
 *      'Non-streaming mode does not support Web Search in thinking mode'.
 *      This rules out every Qwen3.5 and Qwen3.6 model (thinking ON by default).
 *
 *      Both `qwen3-max` and `qwen-plus` default thinking OFF per Alibaba's
 *      docs, so either would stop the 400.
 *
 *   2. `search_strategy: 'agent'`. qwen-client.ts sends
 *      `search_options: { search_strategy: 'agent', enable_source: true }`
 *      on every Stage 1 and Stage 2 call. Per Alibaba's web-search docs,
 *      the `agent` strategy (multi-round agentic search with self-directed
 *      query refinement) is supported ONLY on the qwen3-max series. On
 *      qwen-plus and every other model the value is silently downgraded
 *      to `turbo` (single-round), defeating the multi-round deep-search
 *      Engine B is configured for.
 *
 *   qwen3-max is the unique model that satisfies both constraints:
 *   thinking OFF by default AND native `search_strategy: 'agent'` support.
 *
 *   Refs:
 *     https://help.aliyun.com/zh/model-studio/deep-thinking
 *     https://help.aliyun.com/zh/model-studio/web-search
 */
const DEFAULT_RESEARCHER_MODEL = 'qwen3-max';
```

**Specific Changes**:

1. **String literal**: `'qwen-plus'` → `'qwen3-max'` (one character-range replacement).
2. **Doc-comment rewrite**: document both the thinking-mode crash AND the agent-strategy requirement, since the agent-strategy fact is the reason for preferring `qwen3-max` over `qwen-plus` and would otherwise be a future foot-gun.
3. **Zero other changes in this file** — `DEFAULT_MODEL`, `KimiLoopInput`, `runKimiLoop`, timeouts, all untouched.
4. **Zero changes in any other file** — `qwen-client.ts`, `loop.ts`, `moonshot-client.ts`, `gemini.ts`, and all tests remain unmodified.
5. **Zero DB / env / external-system changes** — no migration, no Inngest resync, no new env var, no prompt-template update.

### Commit Message Draft

```
fix(qwen): switch to qwen3-max to enable agent search strategy

The previous qwen3.5-plus default defaults thinking mode ON, which
Alibaba rejects together with non-streaming + enable_search. The
intermediate qwen-plus swap (uncommitted) would have stopped the
400, but silently downgrades search_strategy: 'agent' to 'turbo'
because only qwen3-max supports agent strategy per Alibaba docs.

qwen3-max: thinking OFF by default + agent search supported +
two-step flow in qwen-client.ts already compatible. This is the
minimum change that both fixes the crash AND actually uses the
agent-mode multi-round search we configured the client for.

No migration. No Inngest resync. No env var change.
```

## Testing Strategy

### Validation Approach

Two-phase. Phase A proves the bug pre-fix (already proven by four production runs returning `b_ok=false`, so no synthetic reproduction required). Phase B proves the fix post-push in two layers: local automated verification (build + unit tests + diagnostics) and runtime smoke test (one manual Inngest trigger + one SQL query).

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix.

**Status**: **Already completed**. Four consecutive production runs with `scheduled_runs.b_ok=false`, `b_refs=0`, and `b_error_class='ServerError'` with payload matching the DashScope HTTP 400 message. The user's Phase 1 investigation has confirmed and captured the counterexample in `bugfix.md` §Verified Facts. No additional exploratory script needed.

**Original counterexample trace**:
```
callQwen({ model: 'qwen3.5-plus', enable_search: true, stream: false, ... })
  → DashScope returns:
      { error: { code: 'InternalError.Algo.InvalidParameter',
                 message: 'Non-streaming mode does not support Web Search in thinking mode' } }
  → HTTP 400
  → callQwen classifies as ServerError (not CreditsExhausted, because 400 ≠ 401/402/403)
  → runKimiLoop Stage 1 aborts → assembled=null → b_ok=false
```

### Fix Checking

**Goal**: Verify that for all inputs satisfying the bug condition, the fixed code produces the expected behavior.

**Pseudocode:**

```
// Static (trivially decidable at build time):
FOR ALL X WHERE isBugCondition(X) DO
  ASSERT NOT modelDefaultsToThinkingOn(DEFAULT_RESEARCHER_MODEL)
    // Decision: DEFAULT_RESEARCHER_MODEL = 'qwen3-max'
    //          → modelDefaultsToThinkingOn('qwen3-max') = false  ✓
END FOR

// Runtime (requires live DashScope call):
trigger one scheduled run with domain='account-health'
SELECT b_ok, b_refs, b_error_class
  FROM scheduled_runs
  ORDER BY triggered_at DESC LIMIT 1;
ASSERT b_ok = true
ASSERT b_refs > 0
ASSERT b_error_class IS NULL
```

**What I (the agent) verify locally before push**:
- `getDiagnostics` on `src/lib/research-engine/engines/kimi.ts` — zero errors.
- `npm run build` — Next.js 16 production build passes, zero TypeScript errors.
- `npx vitest run src/lib/research-engine/engines/__tests__/qwen-client.test.ts` — all 8 tests pass. (These tests do not branch on model id, but we run them anyway as a smoke check that the imports and module structure still compile end-to-end.)

**What the user verifies post-push** (cannot be done from the agent's sandbox):
- Vercel deployment page shows the new commit as "Ready".
- Trigger one run from `/admin/scheduled-runs` ("Trigger now").
- Paste the result of this SQL snippet into chat:
  ```sql
  SELECT id, status, b_ok, b_refs, b_error_class, duration_sec, triggered_at
    FROM scheduled_runs
   ORDER BY triggered_at DESC
   LIMIT 1;
  ```
- **Success criteria**: `status='succeeded'`, `b_ok=true`, `b_refs > 0`, `b_error_class IS NULL`.
- **Partial success** (`b_ok=true` but `b_refs=0`): agent-mode search returned zero URLs — proceed to contingency, see §Risk Analysis.
- **Failure** (`b_ok=false`): inspect `b_error_class` + `b_error_msg`; most likely an unforeseen rate-limit or regional-availability issue; proceed to rollback.

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code produces the same result as the original code.

**Pseudocode:**

```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT originalCallPath(X) = fixedCallPath(X)
END FOR
```

**Testing Approach**: Property-based testing is NOT added here because this spec adds no new code — only a one-literal swap. The existing unit-test suite in `__tests__/qwen-client.test.ts` already covers the preservation surface as **properties** over the request-body shape and response-handling logic. Those properties are invariant under the model-string change:

| Existing test | Property it asserts | Why the fix doesn't affect it |
|---|---|---|
| `fast-path: returns parsed JSON + refs when Step 1 already emits strict JSON` | Step 1 → JSON parse → return without Step 2 | Model string not inspected in parse path |
| `two-step path: Step 1 returns prose, Step 2 structures it into JSON` | Step 1 prose → Step 2 forced → final JSON | Model string not inspected in dispatch |
| `Step 1 sends enable_search WITHOUT response_format` | Request body shape for Step 1 | Fixture already `'qwen3-max'` — now aligned with prod |
| `Step 2 sends response_format=json_object WITHOUT enable_search` | Request body shape for Step 2 | Same — fixture is `'qwen3-max'` |
| `classifies 401 as CreditsExhausted (no retry)` | 4xx → permanent, no retry | HTTP status, not model-dependent |
| `retries on transient 500 then succeeds` | 5xx → retry with backoff | HTTP status, not model-dependent |
| `fails with MalformedResponse when Step 2 returns non-JSON` | Step 2 JSON.parse failure mode | Parse path, not model-dependent |
| `dedupes search references by URL` | `extractSearchReferences` dedup + URL filter | URL set, not model-dependent |

**Test Plan for preservation**:
- Run the 8 existing tests before any edit (baseline — expected 8/8 pass).
- Apply the one-line fix.
- Run the 8 existing tests after the edit (expected 8/8 pass, identical output).
- Any diff in test output is treated as regression and blocks the push.

### Unit Tests

No new unit tests. The fix is a configuration-constant change; the client module is functionally unchanged.

### Property-Based Tests

No new property-based tests. All correctness properties in §Correctness Properties are either:
- Statically decidable from the diff itself (Property 2 — "only one string changes" is verifiable by `git diff`), or
- Runtime-only (Property 1 — only verifiable by a live DashScope call, out of scope for CI).

Adding PBT here would be cargo-cult; the existing suite already tests the full non-model-dependent surface via example-based tests that happen to hold for any model id.

### Integration Tests

No automated integration test. The single manual smoke test (Trigger now + SQL query) is the integration check. Principle 1 (_time doesn't matter — user is offline_) makes the manual trigger acceptable: the user can leave the run to complete and check the result minutes later.

## What Gets Verified by Me vs by the User

**Agent-verified (before declaring push ready)**:
1. `getDiagnostics` on `src/lib/research-engine/engines/kimi.ts` returns zero errors.
2. `npm run build` succeeds with zero TypeScript errors.
3. `npx vitest run src/lib/research-engine/engines/__tests__/qwen-client.test.ts` reports 8/8 passing.
4. `git diff` shows exactly the two modifications described in §Fix Implementation — no spurious whitespace, no unrelated hunks.

**User-verified (post-push, agent cannot do these)**:
1. Vercel Deployments page shows the new commit as "Ready".
2. `/admin/scheduled-runs` Trigger now produces a new row.
3. SQL snippet returns the expected columns (`status='succeeded'`, `b_ok=true`, `b_refs > 0`, `b_error_class IS NULL`).

Reporting contract (per `verification-before-completion.md`): the agent's "done" message will state exactly what the agent verified, what the user must check, and which SQL output signals success vs which signals the contingency path.

## Risk Analysis

### What could still go wrong after this fix?

1. **`qwen3-max` regional / availability issue**. Cross-border Vercel-US → dashscope.aliyuncs.com is occasionally flaky at the TLS / DNS layer (already handled by `MAX_RETRIES=2` exponential-backoff retries in `qwen-client.ts`). If DashScope has a short outage on `qwen3-max` specifically, Engine B fails the run but Engine A still produces output → synthesizer runs on Engine A alone (existing fallback). Not a regression vs. current state.

2. **`qwen3-max` rate limits / quota**. Different from `qwen-plus` in pricing and TPM ceiling. If our TPM/RPM bursts over the `qwen3-max` quota (multiple parallel Stage-2 topics), we'd see HTTP 429 → `RateLimited` (classified, non-retryable). The agent-strategy search consumes more quota per call than `turbo`, so this is a realistic edge case. Mitigation: existing retry budget is 2 attempts; the Inngest-level step runner is single-threaded for Stage 1 but parallel for Stage 2 (one call per top-N topic). No deliberate rate-limiting change in this spec. If rate-limit appears, a follow-up spec adds concurrency caps.

3. **`search_strategy='agent'` returns zero URLs for our prompt**. The agent strategy is more selective than `turbo` — it can decide no web search is needed and return a prose-only response. For hot-radar queries asking for this-week topics, zero URLs is unexpected but not impossible if the prompt framing misleads the agent. Observable as `b_ok=true, b_refs=0` in the SQL snippet.

4. **`qwen3-max` response-shape drift**. `qwen3-max` responses may embed `search_results` in a field `qwen-client.ts`'s `extractSearchReferences` doesn't recognize. Current extractor probes both `choices[0].message.search_info.search_results` (OpenAI-compat) and `output.search_info.search_results` (native). If `qwen3-max` uses a third shape, `b_refs=0` again.

5. **Unforeseen new constraint**. Four previous attempts each hit a novel DashScope constraint. There may be a fifth we haven't enumerated. The rollback path is designed for this.

### Contingencies

| Observation | Likely cause | Action |
|---|---|---|
| `b_ok=false, b_error_class='ServerError', http 400` | Some other body-shape rejection | Read `b_error_msg`, open new spec |
| `b_ok=false, b_error_class='RateLimited'` | `qwen3-max` quota below our TPM | Wait + retry manually; if persistent, add concurrency cap follow-up |
| `b_ok=false, b_error_class='CreditsExhausted'` | DashScope auth / billing | User checks Alibaba console |
| `b_ok=false, b_error_class='TimeoutError'` | Agent-mode search exceeded 240 s | Consider raising `hotRadarTimeoutMs` — Principle 1 says time budget is flexible |
| `b_ok=true, b_refs=0` | Agent strategy returned prose only OR response shape drift | **Contingency plan**: swap back to `search_strategy: 'max'` (`qwen3-max`-compatible but single-round, behaves like the `turbo` strategy pre-agent era). This is **NOT implemented preemptively** — only after observing the symptom |
| `b_ok=true, b_refs > 0, status='succeeded'` | Fix works | Close the spec |

### Rollback Plan

Three levels, each one step further back:

1. **Revert this commit**: `git revert <new-sha>` → HEAD returns to `9fbef2b`. DashScope rejects again with HTTP 400, `b_ok=false, b_refs=0`. No worse than current production state. Use if the new commit breaks something we can't diagnose in the moment.

2. **Revert to pre-Qwen-engine-switch**: `git revert` through the Qwen PR series (`6c9ccad`, `715962e`). Engine B returns to OpenRouter `:online` (the pre-Qwen-direct Engine B). Known-good but loses the heterogeneous CN-search design goal. Use only if `qwen3-max` is discovered to be fundamentally incompatible with this project.

3. **Disable Engine B entirely**: set `QWEN_API_KEY` to empty string in Vercel env → `runKimiLoop` fails fast with `'qwenApiKey is missing'` → synthesizer uses Engine A alone. Degraded product but stable. Use only if both above fail.

All three are user-executable from chat + Vercel UI in under 5 minutes.

## Deferred Work (Explicitly Out of Scope)

All of the following were discussed during Phase 1 but are explicitly NOT part of this spec, per user's decision. They become a separate follow-up spec once this minimum fix lands and stabilizes:

- **Stage 1 `freshness` parameter** (hard time filter, e.g. last 7 days). Conflicts with `search_strategy='agent'` per Alibaba docs; needs a separate evaluation for Stage 1 (`turbo + freshness=7`) vs Stage 2 (`agent` preserved).
- **DB prompt changes** (`engine_b_hot_radar`, `shared_deep_dive`, Stage 3/4 prompts). Current prompts stay as-is; any prompt-level time-hint is part of the follow-up.
- **New `reports.first_seen_date` schema field** + normalizer time filtering. Requires migration + new index; out of scope.
- **Runtime date-hint injection** into system prompts at the code layer (injecting today's date or coverage-window dates dynamically). Different design question — belongs to the freshness spec.
- **Applying changes symmetrically to Engine A (Moonshot)**. Engine A is not crashing, so Principle 6 (minimum fix) says leave it alone.
- **Stage 3 / Stage 4 prompt or model changes**. Stage 3/4 use OpenRouter, not DashScope; they never triggered the bug.
- **Fallback chain in `qwen-client.ts`** (auto-retry with fallback model on specific error classes). Speculative defense; four prior attempts show "add more code" is often the wrong direction. Adopt only if runtime evidence shows a recurring pattern.
- **`extra_body.enable_thinking=false` parameter**. Alternative fix strategy; not needed once `qwen3-max` is chosen.
- **Unit-test fixture updates**. Tests already use `'qwen3-max'` — no fixture change necessary.
