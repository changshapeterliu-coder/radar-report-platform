# Implementation Plan

Minimum-scope bugfix: swap `DEFAULT_RESEARCHER_MODEL` in `src/lib/research-engine/engines/kimi.ts` from `'qwen-plus'` (uncommitted working-tree value) to `'qwen3-max'`, and rewrite the doc-comment block above it to document both the thinking-mode-off requirement AND the `search_strategy: 'agent'` requirement per Alibaba docs.

**Files touched**: `src/lib/research-engine/engines/kimi.ts` — that's it.

---

- [x] 1. Bug-condition exploration — N/A (already proven by production evidence)
  - **Property 1: Bug Condition** — Qwen3.5-Plus triggers thinking-mode HTTP 400
  - **Status**: Already completed by Phase 1 investigation. Per design.md §Exploratory Bug Condition Checking: "No additional exploratory script needed."
  - **Evidence already captured** (bugfix.md §Verified Facts):
    - Four consecutive `scheduled_runs` rows with `b_ok=false, b_refs=0, b_error_class='ServerError'`
    - DashScope returns HTTP 400 `InternalError.Algo.InvalidParameter`: _"Non-streaming mode does not support Web Search in thinking mode"_
    - Call path: `callQwen({ model: 'qwen3.5-plus', enable_search: true, stream: false })` → `isBugCondition(X) = true`
  - **Why no synthetic test is written**: the production DB + DashScope error message is a stronger counterexample than any mock could produce, and writing a vitest that hits live DashScope would require a real API key and break the offline CI guarantee. Principle 2 (no speculative defenses) + Karpathy "simplicity first" both point to skipping this.
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Preservation baseline — verify existing unit tests pass on current working tree
  - **Property 2: Preservation** — `qwen-client.ts` behavior is invariant under model-string change
  - **Observation-first**: before touching `kimi.ts`, confirm the 8 existing tests in `__tests__/qwen-client.test.ts` pass on the current working tree (which has `DEFAULT_RESEARCHER_MODEL='qwen-plus'` uncommitted)
  - Run: `npx vitest run src/lib/research-engine/engines/__tests__/qwen-client.test.ts`
  - **Expected**: 8/8 tests pass
  - Tests cover the full preservation surface per design.md §Preservation Checking table:
    - Step 1 request shape (enable_search=true, no response_format, search_strategy='agent')
    - Step 2 request shape (response_format=json_object, no enable_search)
    - Fast-path JSON parsing
    - Two-step fallback for prose Step 1
    - 401 → CreditsExhausted classification, no retry
    - 500 → retry with backoff, then succeed
    - MalformedResponse when Step 2 returns non-JSON
    - URL dedup in `extractSearchReferences`
  - Test fixtures already use `'qwen3-max'` as the model string — the client never branches on model id, so fixtures stay valid after the fix
  - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.7_

- [x] 3. Fix for qwen-engine thinking-mode crash

  - [x] 3.1 Apply the fix to `src/lib/research-engine/engines/kimi.ts`
    - Change line 54: `const DEFAULT_RESEARCHER_MODEL = 'qwen-plus';` → `const DEFAULT_RESEARCHER_MODEL = 'qwen3-max';`
    - Rewrite the JSDoc doc-comment block above the constant to the exact "After" text in design.md §Fix Implementation (both reasons: thinking-mode-off AND `search_strategy: 'agent'` native support; both Alibaba docs URLs cited: `deep-thinking` + `web-search`)
    - Do NOT touch anything else in this file (`DEFAULT_MODEL`, `KimiLoopInput`, `runKimiLoop`, timeouts all stay byte-identical)
    - Do NOT touch any other file (`qwen-client.ts`, `loop.ts`, `moonshot-client.ts`, `gemini.ts`, all tests stay unmodified)
    - _Bug_Condition: `isBugCondition(X) = X.enable_search=true AND X.stream=false AND modelDefaultsToThinkingOn(X.model)` from design.md §Bug Condition_
    - _Expected_Behavior: DashScope accepts request (HTTP 200), executes multi-round agent search, returns `search_info.search_results` with ≥ 1 entry from design.md §Correctness Properties Property 1_
    - _Preservation: Preservation Requirements 3.1-3.7 from design.md — only the string literal and doc-comment change; every non-Engine-B call path and the Step 2 path in callQwen are byte-identical_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.2 Verify bug-condition exploration expectation is met (static check)
    - **Property 1: Expected Behavior** — `DEFAULT_RESEARCHER_MODEL` is not a thinking-on-default model
    - Run: `getDiagnostics` on `src/lib/research-engine/engines/kimi.ts` — expect zero errors
    - Read `kimi.ts` line 54 back and confirm the literal is `'qwen3-max'`
    - Confirm `modelDefaultsToThinkingOn('qwen3-max') = false` per design.md §Bug Condition (qwen3-max is NOT in the `qwen3.5-*` / `qwen3.6-*` / `qwq-*` thinking-on sets)
    - **Expected outcome**: static property holds — no production call from `runKimiLoop` can satisfy `isBugCondition()` anymore
    - (The runtime-property part — live DashScope HTTP 200 + `b_refs > 0` — is deferred to task 5, post-deploy)
    - _Requirements: 2.1, 2.2_

  - [x] 3.3 Verify preservation tests still pass after the fix
    - **Property 2: Preservation** — `qwen-client.ts` behavior unchanged
    - Run the SAME command from task 2: `npx vitest run src/lib/research-engine/engines/__tests__/qwen-client.test.ts`
    - **Expected**: still 8/8 pass, identical output as task 2 baseline
    - Any diff vs. task 2 output is a regression and blocks the push
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.7_

  - [x] 3.4 Verify build and diff scope
    - Run: `npm run build` — expect Next.js 16 production build succeeds with zero TypeScript errors
    - Run: `git diff src/lib/research-engine/engines/kimi.ts` — expect exactly two semantic hunks: the constant line + the doc-comment block above it. No other hunks, no whitespace noise elsewhere in the file
    - Run: `git diff --stat` — expect `src/lib/research-engine/engines/kimi.ts` is the ONLY modified tracked file (untracked draft-spec folder is unrelated and stays out of the commit)
    - _Requirements: 3.1, 3.6 (Engine A and Stage 3/4 byte-identical — proven by "no other tracked file changed")_

- [x] 4. Commit and push (user confirmation required)

  - [x] 4.1 Stage and commit
    - `git add src/lib/research-engine/engines/kimi.ts` (stage ONLY this file — not the untracked `.kiro/specs/draft-report-map-undefined-crash/` folder, not this spec folder either unless user explicitly asks)
    - Commit with the message from design.md §Commit Message Draft (the `fix(qwen): switch to qwen3-max to enable agent search strategy` block)
    - Show the user the commit SHA and `git show --stat HEAD` output
    - _Requirements: n/a (mechanical git step)_

  - [x] 4.2 Ask user before pushing to origin/main
    - Per git_safety + safety_guardrails: pushes to main need explicit user confirmation
    - Use `userInput` tool with the commit SHA + one-line summary + "push to origin/main? y/n"
    - Do NOT push until user answers affirmatively
    - _Requirements: n/a (policy step)_

  - [x] 4.3 Push to origin/main
    - `git push origin main`
    - Confirm `git log origin/main -1` shows the new commit
    - Tell the user to watch Vercel Deployments for the new commit to go "Ready"
    - _Requirements: n/a (mechanical git step)_

- [ ] 5. Post-deploy verification (user-executed, agent-interpreted)

  - [-] 5.1 Wait for user to confirm Vercel deployment "Ready"
    - Agent cannot observe Vercel directly
    - Ask user: "Vercel Deployments 页面上新 commit 显示 Ready 了吗?"
    - _Requirements: deploy-pipeline gate from design.md §What Gets Verified by User_

  - [ ] 5.2 Ask user to trigger one scheduled run
    - Instruct: go to `/admin/scheduled-runs`, click "Trigger now"
    - Wait for the run to finish (Inngest Stage 1-4 typically 3-8 minutes for this pipeline)
    - Per Principle 1 (time doesn't matter — user is offline): user can walk away and come back
    - _Requirements: smoke-test gate from design.md §Fix Checking_

  - [ ] 5.3 Collect SQL evidence (single round-trip per debugging-discipline Rule 4)
    - Ask user to paste the result of:
      ```sql
      SELECT id, status, b_ok, b_refs, b_error_class, b_error_msg, duration_sec, triggered_at
        FROM scheduled_runs
       ORDER BY triggered_at DESC
       LIMIT 1;
      ```
    - _Requirements: evidence-collection gate_

  - [ ] 5.4 Interpret the SQL result per design.md §Risk Analysis contingency table
    - **Success** (`status='succeeded', b_ok=true, b_refs > 0, b_error_class IS NULL`): fix works → close the spec
    - **Partial success** (`b_ok=true, b_refs=0`): agent-mode returned zero URLs → go to task 6 (contingency)
    - **Failure — ServerError 400 with different message**: new unforeseen DashScope constraint → stop, open new spec, do not patch blind
    - **Failure — RateLimited**: `qwen3-max` quota exceeded by agent-mode cost → advise user to wait, or open follow-up for concurrency cap
    - **Failure — CreditsExhausted**: DashScope billing/auth issue → user checks Alibaba console
    - **Failure — TimeoutError**: agent-mode search > 240 s → follow-up spec to raise `hotRadarTimeoutMs`
    - _Requirements: 2.1, 2.2, 2.3 (runtime verification of Property 1)_

- [ ]* 6. Contingency — swap `search_strategy: 'agent'` → `'max'` (ONLY if task 5.4 shows `b_ok=true, b_refs=0`)
  - **Status**: optional, conditional on observed symptom. Do NOT execute preemptively.
  - Per design.md §Risk Analysis row "b_ok=true, b_refs=0": if agent-mode returns prose-only with no URLs, swap to `search_strategy: 'max'` in `src/lib/research-engine/engines/qwen-client.ts` (around line 96)
  - Note: `'max'` is qwen3-max's native single-round strategy (analog of the old `'turbo'`), not the same thing as the model name. See Alibaba web-search docs.
  - After swap: repeat tasks 3.3 → 3.4 → 4 → 5 against the follow-up commit
  - Rollback plan stays the same (revert the contingency commit; main goes back to `qwen3-max` + `agent`)
  - _Requirements: contingency-path from design.md §Risk Analysis_

- [ ] 7. Checkpoint — ensure all gates passed, report completion honestly
  - Before declaring done, confirm per verification-before-completion.md:
    - ✓ `getDiagnostics` on `kimi.ts` zero errors (task 3.2)
    - ✓ `npm run build` passes (task 3.4)
    - ✓ 8/8 unit tests pass before AND after the fix (tasks 2 + 3.3)
    - ✓ `git diff` scope is exactly two hunks in one file (task 3.4)
    - ✓ Commit pushed to origin/main with user's explicit confirmation (task 4.2-4.3)
    - ✓ Vercel shows new commit Ready (task 5.1)
    - ✓ Manual trigger produced `scheduled_runs` row with `b_ok=true, b_refs > 0, b_error_class IS NULL` (task 5.4 success branch)
  - Use the "done message template" from verification-before-completion.md:
    - What I verified (agent-side): diagnostics, build, unit tests, diff scope
    - What YOU verified (user-side): Vercel Ready, `b_ok=true` in SQL
    - If contingency (task 6) was hit: state that + the new commit SHA
  - If any gate failed and was NOT covered by a contingency branch, STOP and ask user before closing — do not declare done with unresolved red signals
  - _Requirements: all (final gate)_
