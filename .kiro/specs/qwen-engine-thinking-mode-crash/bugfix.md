# Bugfix Requirements Document

## Introduction

Engine B (Alibaba Qwen via DashScope) fails every production run during `hot-radar-scan` stage with HTTP 400:

```
Non-streaming mode does not support Web Search in thinking mode.
error code: InternalError.Algo.InvalidParameter
```

Root cause: the deployed model `qwen3.5-plus` is from Alibaba's Qwen3.5 Plus series, which per official docs is **混合思考模式，默认开启思考模式** (hybrid thinking mode, thinking ON by default). DashScope's API forbids the combination `enable_search + non-streaming + thinking_mode`. The `callQwen` client uses non-streaming HTTP POST with `enable_search: true`, so every Stage 1 and Stage 2 call on Engine B hits this 400.

Impact: cross-engine heterogeneity is broken. Every `scheduled_runs` row shows `b_ok=false, b_refs=0`. Reports are being synthesized from Engine A output alone, which defeats the product design of two-engine confirmation via complementary search coverage (Moonshot social/小红书/知乎 + Qwen e-commerce/1688/Taobao).

A fix is already staged in the working tree (uncommitted): switch `DEFAULT_RESEARCHER_MODEL` in `src/lib/research-engine/engines/kimi.ts` from `qwen3.5-plus` to `qwen-plus`. Per the same Alibaba docs, `qwen-plus` is the Qwen3 Plus series — **混合思考模式，默认不开启思考模式** (thinking OFF by default) — which satisfies DashScope's `enable_search + non-streaming` constraint without any `extra_body.enable_thinking=false` parameter.

This document specifies the bug condition, the expected fix, and what must be preserved.

### Verified facts (cross-checked against repo + Alibaba docs)

- **Only callsite of `callQwen`** is `loop.ts` → `callResearcher` (when `researcherProvider === 'qwen'`). The only configuration that sets `researcherProvider='qwen'` is `runKimiLoop` in `kimi.ts`. No other code paths hit DashScope. Engine A (Moonshot) is unaffected.
- **Two-step architecture in `qwen-client.ts`** is sound and complete:
  - Step 1: `enable_search=true`, no `response_format` → natural-language digest. Search references + search count extracted.
  - Step 2: `response_format={type:'json_object'}`, no `enable_search` → strict JSON reformat.
  - Fast-path skips Step 2 if Step 1 already returns parseable JSON.
  - 8 unit tests exist in `__tests__/qwen-client.test.ts`. The tests do NOT depend on the concrete model string — they pass `'qwen3-max'` as a test fixture, but that is irrelevant: the client code never branches on model id, only on HTTP status and response shape. Changing the deployed model does not affect the test surface.
- **Alibaba docs confirm** (https://help.aliyun.com/zh/model-studio/deep-thinking):
  - `qwen-plus`, `qwen-plus-latest`, `qwen-plus-2025-04-28+` — 默认不开启思考模式 ✓
  - `qwen3.5-plus`, `qwen3.5-plus-2026-02-15` — 默认开启思考模式 ✗ (the broken model)
- **Git state as of this writing**:
  - HEAD and origin/main both at `9fbef2b` ("fix(qwen): switch from qwen3-max to qwen3.5-plus"). This is the broken commit currently serving production.
  - Working tree: `src/lib/research-engine/engines/kimi.ts` modified locally (qwen-plus + doc comment) — uncommitted, not deployed.

## Bug Analysis

### Current Behavior (Defect)

When Engine B runs against DashScope with the deployed model `qwen3.5-plus`, every Stage 1 and Stage 2 call is rejected by the API because the (model default thinking=ON) × (`enable_search=true`) × (non-streaming) combination is forbidden.

1.1 WHEN `callQwen` is invoked with `model='qwen3.5-plus'` (or any other Qwen series that defaults to thinking mode ON) AND `enable_search=true` AND the HTTP request is non-streaming THEN the DashScope API SHALL respond with HTTP 400 and error code `InternalError.Algo.InvalidParameter` ("Non-streaming mode does not support Web Search in thinking mode")

1.2 WHEN the HTTP 400 above is received THEN `callQwen` returns `{ok: false, error: {errorClass: 'ServerError', httpStatus: 400, ...}}` and the Engine B loop SHALL abort Stage 1 with no retry (4xx is permanent per retry policy) and return `assembled=null`

1.3 WHEN Engine B Stage 1 aborts THEN the `scheduled_runs` row SHALL record `b_ok=false, b_refs=0, b_error_class='ServerError'`, the synthesizer SHALL run on Engine A output alone, and cross-engine heterogeneity SHALL be lost for that run

### Expected Behavior (Correct)

2.1 WHEN `callQwen` is invoked with the configured Engine B researcher model AND `enable_search=true` AND non-streaming THEN the DashScope API SHALL accept the request (HTTP 200) because the configured model SHALL default to thinking mode OFF

2.2 WHEN Step 1 completes successfully THEN `callQwen` SHALL return `{ok: true, data, searchReferences, searchCount}` with `searchReferences.length >= 1` for a realistic hot-radar query (the search actually runs, not a prose-only response)

2.3 WHEN a full production run executes THEN the `scheduled_runs` row SHALL record `b_ok=true, b_refs > 0` and both engines SHALL contribute to the synthesizer input

### Unchanged Behavior (Regression Prevention)

3.1 WHEN Engine A (Moonshot, `runGeminiLoop`) runs THEN the system SHALL CONTINUE TO use `kimi-k2.6` via `callMoonshot` with no behavioral change (Engine A never calls DashScope; it is unaffected by any Engine B model change)

3.2 WHEN the two-step flow in `callQwen` executes THEN the system SHALL CONTINUE TO send Step 1 with `enable_search=true` and no `response_format`, and Step 2 with `response_format={type:'json_object'}` and no `enable_search` (this is the correct architecture from commit `6c9ccad` and must not be touched)

3.3 WHEN `callQwen` receives a 5xx response OR a network error THEN the system SHALL CONTINUE TO retry up to `MAX_RETRIES=2` with exponential backoff (`BACKOFF_BASE_MS=500`)

3.4 WHEN `callQwen` receives 401/402/403 THEN the system SHALL CONTINUE TO classify as `CreditsExhausted` and NOT retry

3.5 WHEN the 8 existing unit tests in `__tests__/qwen-client.test.ts` run THEN they SHALL CONTINUE TO pass unchanged (the tests use `'qwen3-max'` as a model-id fixture only; the client does not branch on model id, so the fixture remains valid)

3.6 WHEN Stage 3 (education-mapper) and Stage 4 (assembler) run THEN the system SHALL CONTINUE TO use `moonshotai/kimi-k2-0905` via OpenRouter (unchanged — this is `DEFAULT_MODEL` in `kimi.ts`, not `DEFAULT_RESEARCHER_MODEL`)

3.7 WHEN search references are collected from Qwen responses THEN the system SHALL CONTINUE TO probe both `choices[0].message.search_info.search_results` (OpenAI-compatible shape) and `output.search_info.search_results` (native DashScope shape) and dedupe by URL

## Bug Condition & Property

### Bug Condition — `C(X)`

```pascal
FUNCTION isBugCondition(X)
  INPUT:  X = { model: string, enable_search: boolean, stream: boolean }
          // i.e. the HTTP body sent to DashScope /chat/completions
  OUTPUT: boolean

  // The API rejects non-streaming + search + thinking-mode-on.
  // The client never sets stream=true, so X.stream is always false here.
  // thinking-mode-on is a property of the *model default* (no extra_body override
  // in the call path), so we predicate it on the model id.
  RETURN X.enable_search = true
     AND X.stream = false
     AND modelDefaultsToThinkingOn(X.model)
END FUNCTION

FUNCTION modelDefaultsToThinkingOn(model)
  // Per https://help.aliyun.com/zh/model-studio/deep-thinking
  // "默认开启思考模式" series:
  RETURN model STARTSWITH 'qwen3.5-'       // e.g. qwen3.5-plus, qwen3.5-flash
      OR model STARTSWITH 'qwen3.6-'       // e.g. qwen3.6-plus, qwen3.6-max-preview
      OR model IN {'qwq-plus', 'qwq-32b', ...}  // 仅思考 series
      // "默认不开启" series (safe for enable_search + non-streaming):
      //   qwen-plus, qwen-plus-latest, qwen-plus-2025-04-28+
      //   qwen-flash, qwen-turbo, qwen3-max
END FUNCTION
```

Concrete counterexample currently reproducing in production:

```
X = {
  model: 'qwen3.5-plus',
  enable_search: true,
  stream: false,                 // callQwen never streams
  // (search_options, messages, etc. — irrelevant to the bug condition)
}
→ isBugCondition(X) = true
→ F(X) = HTTP 400 InvalidParameter
```

### Property — `P(F'(X))`

```pascal
// Fix Checking: for all inputs matching the bug condition,
// the fixed code must not send a model that triggers the bug.
FOR ALL X WHERE isBugCondition(X) DO
  // The fix operates at configuration time, not request time:
  // after the fix, no code path in the production codebase SHALL
  // invoke callQwen with modelDefaultsToThinkingOn(X.model) = true.
  ASSERT NOT modelDefaultsToThinkingOn(configuredResearcherModel)
    WHERE configuredResearcherModel = kimi.ts DEFAULT_RESEARCHER_MODEL
END FOR

// Operational observation of F' (the deployed fix):
//   calling F' against real DashScope with the production prompts
//   returns HTTP 200, searchReferences.length >= 1, and b_ok = true
//   in the resulting scheduled_runs row.
```

### Preservation — `NOT C(X)`

```pascal
// Preservation Checking: for all call paths that do NOT match the bug
// condition (i.e. Engine A Moonshot calls, OpenRouter calls, Stage 3/4
// calls, and the structure of Step 2 in callQwen which sets
// enable_search=false), the fixed code SHALL behave identically to F.
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

Concretely, `NOT C(X)` covers:
- Any `callMoonshot` invocation (Engine A Stage 1/2).
- Any `callOpenRouter` invocation (Stage 3/4, synthesizer).
- The Step 2 call inside `callQwen` (has `enable_search=false`, so even if the model defaulted to thinking-on, the bug condition isn't met).
- The unit test fixtures (no real HTTP; they mock `fetch`).

The only diff permitted by the fix is the value of the string literal `DEFAULT_RESEARCHER_MODEL` in `kimi.ts`.

## Minimum Fix Set

The fix is a **one-line string change** plus a supporting comment block. Nothing in the architecture, retry policy, or test surface changes.

1. **Code change** (already present in working tree, uncommitted):
   - `src/lib/research-engine/engines/kimi.ts` line 54:
     ```
     const DEFAULT_RESEARCHER_MODEL = 'qwen-plus';   // was 'qwen3.5-plus'
     ```
   - Supporting comment block (already authored) documents Alibaba's thinking-mode matrix and cites the docs URL. Principle 2 compliant: fix is at the API/model-selection layer, not in the prompt.

2. **Verification** (must pass before push):
   - `npx vitest run src/lib/research-engine/engines/__tests__/qwen-client.test.ts` — all 8 tests pass.
   - `npm run build` — Next.js production build succeeds, zero TypeScript errors.
   - `getDiagnostics` on `kimi.ts` — zero errors.

3. **Deploy**: commit → push to `main` → Vercel picks up → Inngest serves new bundle on next scheduled run (no Inngest resync needed; the function signature and config are unchanged, only a string literal inside a module).

4. **Post-deploy smoke test**: trigger one run manually from `/admin/scheduled-runs`, then verify in Supabase SQL Editor:
   ```sql
   SELECT id, status, b_ok, b_refs, b_error_class, triggered_at
   FROM scheduled_runs
   ORDER BY triggered_at DESC
   LIMIT 1;
   ```
   Expected: `status='succeeded'`, `b_ok=true`, `b_refs > 0`, `b_error_class IS NULL`.

5. **Rollback** (if `qwen-plus` itself misbehaves for some reason): revert commit; HEAD returns to `9fbef2b` (known-broken but no-worse-than-current). Then escalate to the fallback strategy — see open questions.

No migration. No Inngest resync. No env var change. No prompt change.

## Open Questions for Phase 2 (Design)

These are orchestrator-level decisions that shape the scope of the design document:

### Q1. Robust fallback vs. simple model swap

The uncommitted fix is the minimum possible: swap one model string. It assumes `qwen-plus` works in production. If it also hits an unforeseen DashScope edge case (different error, rate limit, regional availability, service degradation), we're back to `b_ok=false`.

**Options for Phase 2 design**:

- **A. Simple swap (current working-tree state)**. Change the default to `qwen-plus`. Ship it. If it breaks, we iterate.
  - Pro: 1-line change, matches Karpathy simplicity-first, lowest rollback cost.
  - Con: if `qwen-plus` degrades, Engine B breaks again and we re-enter the loop.

- **B. Defensive fallback chain** inside `qwen-client.ts` or `loop.ts`. On a specific class of 400 (thinking-mode error) or quota 429 on the primary model, retry once with a fallback model — e.g. `qwen-plus-latest` → `qwen-turbo` → give up.
  - Pro: self-healing against single-model issues.
  - Con: more code, more tests, more complexity. Principle-1-safe (time is cheap). But it's adding scope to a bug that has failed 4× already; next failure may not be a model-availability issue at all.

- **C. Explicit `extra_body.enable_thinking=false` override in Step 1**. Per Alibaba docs, this works even on thinking-on-by-default models. Then we could use any Qwen model, not just qwen-plus.
  - Pro: decouples model choice from thinking-mode-default, more model options.
  - Con: more API surface to test; `extra_body` behavior can vary across OpenAI-compatible vs native DashScope protocol; we haven't observed this in production.

**My recommendation**: **Option A** for this fix, tracked as a standalone "Qwen fallback hardening" spec later if degradation occurs. Rationale: 4 previous attempts expanded scope and each hit a new constraint. Going smallest-possible now maximizes the chance of actually reaching green, and per Principle 2 / Karpathy we don't add speculative defenses for impossible-scenarios.

**User must confirm**: A / B / C.

### Q2. Should the code comment in `kimi.ts` be corrected about `qwen3-max`?

The current working-tree comment says:
> "Both qwen3-max and qwen3.5-plus default to thinking mode ON."

Per Alibaba docs, this is half-wrong: `qwen3-max` is actually **默认不开启思考模式** (same as `qwen-plus`). Only `qwen3.5-plus` defaults to ON.

**Options**: leave the slightly-wrong comment (harmless; we're not using qwen3-max anyway) vs. fix it as part of this spec vs. defer.

**My recommendation**: fix it in Phase 2 (trivial 2-line edit in the same comment block), since we're already touching this file. Low cost, prevents future confusion.

**User must confirm**: fix comment / leave as-is.

### Q3. Does the unit-test fixture `'qwen3-max'` need updating?

Tests pass `'qwen3-max'` as a placeholder model id. The client never branches on model id, so the fixture is semantically neutral. But a future reader might wonder why tests use a different model than production.

**Options**: leave the test fixture unchanged / update to `'qwen-plus'` for consistency / add a comment explaining the fixture is just a string.

**My recommendation**: leave unchanged. Updating the fixture would expand the diff into the test file for zero behavioral reason (Principle: surgical changes). Add no comment either — it's already fine.

**User must confirm** (low stakes): change test fixture / leave it.

### Q4. Verification evidence before pushing

Options for how confident we want to be before the push:

- **Minimal**: build passes + unit tests pass. Push. Watch the next scheduled run.
- **Medium**: above, plus one manual trigger on staging/prod and confirm DB row `b_ok=true`.
- **Belt-and-braces**: above, plus a one-off script that calls `callQwen` with the new model against a tiny fixture prompt to confirm HTTP 200 before committing.

**My recommendation**: **Medium**. Build+tests alone have proven insufficient in this series (4 previous attempts all had passing tests). Triggering one run post-push catches 90% of "new Alibaba constraint" surprises. A standalone pre-commit script is nice but not worth building for a 1-line fix.

**User must confirm**: minimal / medium / belt-and-braces.
