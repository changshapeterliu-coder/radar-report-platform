# Implementation Plan: Engine B GLM Replacement

## Overview

Swap Engine B's Stage 1 / Stage 2 research backend from Alibaba DashScope / Qwen to Zhipu AI / GLM (z.ai). The swap is atomic: new `zai-client.ts` module + tests, `kimi.ts` / `loop.ts` / `generate-report.ts` / `index.ts` / `scheduled-runs.ts` rename `qwenApiKey → zaiApiKey` and flip `researcherProvider` to `'zai'`, and `qwen-client.ts` + its test are deleted in the same commit. A live-API probe script (`scripts/probe-glm.ts`) is the pre-push gate — the main lesson from the Qwen cycle is that unit tests ≠ live API acceptance.

Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.

**Env var naming**: The user confirmed the real legacy env var in Vercel is `DASHSCOPE_API_KEY` (the requirements doc calls it `QWEN_API_KEY` conceptually, but code reads `process.env.DASHSCOPE_API_KEY`). This swap replaces that read with `process.env.ZAI_API_KEY`.

**Pre-push gate (Q10)**: `scripts/probe-glm.ts` MUST succeed against a real `ZAI_API_KEY` before the commit is pushed. No exceptions.

**Atomic PR shape**: one commit swaps Engine B entirely — new files + modified files + deleted files, so `git revert <sha>` produces a clean rollback.

## Tasks

- [x] 1. Set up ZAI_API_KEY locally (user action — required before probe)
  - [x] 1.1 (user action) Sign up at https://z.ai and obtain a `ZAI_API_KEY` (format `sk-...`); the key must have `glm-4.6` access
  - [x] 1.2 (user action) Export the key in the same PowerShell session where the probe will run:
    ```powershell
    $env:ZAI_API_KEY = "sk-..."
    ```
    Confirm with `echo $env:ZAI_API_KEY` — should print the key, not empty.
  - [x] 1.3 (user action) Also add `ZAI_API_KEY` to Vercel → Project Settings → Environment Variables (Production + Preview) so the post-merge deploy has it. **Do not delete `DASHSCOPE_API_KEY` yet** — per design §8 it stays live as the Tier 1 rollback window through post-deploy verification.
  - [x] 1.4 (GATE) Wait for user confirmation "have key" before proceeding to task 2. Do not proceed without explicit confirmation.
  - _Requirements: 5.1, 5.5_

- [x] 2. Create `src/lib/research-engine/engines/zai-client.ts`
  - [x] 2.1 Write the full module per design §5 and §6
    - `ZAI_ENDPOINT = 'https://api.z.ai/api/paas/v4/chat/completions'` constant
    - Export `ZaiCallParams`, `ZaiResult<T>` types exactly as specified in design §5
    - Export `callZai<T>(params): Promise<ZaiResult<T>>` — single HTTP call, no tool_calls loop
    - Request body: `{ model, messages, thinking: { type: 'disabled' }, response_format?, tools: [{ type: 'web_search', web_search: { enable: 'True', search_result: 'True', search_recency_filter?, content_size? } }], temperature: 0.3, max_tokens: 8192 }` — note `'True'` / `'False'` as strings per z.ai convention
    - Parser: `stripCodeFences(choices[0].message.content)` → `JSON.parse` → `data`
    - Extract `web_search[]` → `EngineSearchReference[]` with `link → url`, `publish_date → published_date` (empty string → undefined), `content` truncated to 200 chars → `snippet`, `provider: 'zai'`
    - Dedupe references by URL
    - Error classification per design §6 table: 401/402/403 → `CreditsExhausted`, 429 → `RateLimited`, 5xx → `ServerError` (retry ×2 exponential backoff 500ms/1000ms), `AbortError` → `TimeoutError`, other fetch throw → `NetworkError` (retry ×2), malformed → `MalformedResponse`, `finish_reason === 'tool_calls'` → `MalformedResponse`
    - Reuse `stripCodeFences` and `ChatMessage` type from `./openrouter-client`
    - Inline small helpers (`classifyHttpStatus`, `truncate`, `delay`) mirroring the style of `moonshot-client.ts`
    - Docblock comment at top citing `https://docs.z.ai/guides/tools/web-search` and summarizing the three-in-one novelty (`thinking: disabled` + `json_object` + `web_search` in one call)
  - [x] 2.2 Run `getDiagnostics` on `src/lib/research-engine/engines/zai-client.ts` — must return zero errors before proceeding
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 13.1, 13.2, 13.3_

- [x] 3. Create `src/lib/research-engine/engines/__tests__/zai-client.test.ts`
  - [x] 3.1 Copy the test harness pattern from `qwen-client.test.ts` — `vi.stubGlobal('fetch', fetchMock)` in `beforeEach`, `vi.unstubAllGlobals()` in `afterEach`; `successResponse` / `errorResponse` builders matching z.ai envelope shape (top-level `choices[0].message.content` string + top-level `web_search[]` array with `{ title, link, publish_date, content, media, refer, icon }`)
  - [x] 3.2 Implement all 9 cases from design §9.1:
    1. `successful JSON parse` — 200 + strict-JSON content + `web_search[]` → `ok:true`, `data` parsed, `searchCount === web_search.length`
    2. `web_search tool call round-trip` — outgoing body has `tools: [{ type:'web_search', web_search: { enable:'True', search_result:'True' } }]`; response `web_search[]` parses into refs with `provider:'zai'`, `url` from `link`
    3. `search_recency_filter is forwarded` — `searchRecency:'oneMonth'` appears in outgoing `tools[0].web_search.search_recency_filter`; same assertion for `contentSize`
    4. `401 classified as CreditsExhausted without retry` — `fetchMock` 401 → `errorClass:'CreditsExhausted'`, `httpStatus:401`, called exactly 1 time
    5. `429 classified as RateLimited` — 429 → `errorClass:'RateLimited'`, called 1 time
    6. `transient 500 retried once then succeeds` — first 500, second 200 → `ok:true`, called 2 times
    7. `malformed response body` — 200 with content `"not valid json"` → `errorClass:'MalformedResponse'`
    8. `abort classified as TimeoutError` — `fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))` → `errorClass:'TimeoutError'`
    9. `search references deduped by URL` — response with 3 `web_search[]` entries, two sharing same `link` → result has 2 refs
  - [x] 3.3 Run `npx vitest run src/lib/research-engine/engines/__tests__/zai-client.test.ts` — expect 9/9 pass. If any fail, fix `zai-client.ts` (the test encodes the contract; the implementation must match it)
  - _Requirements: 7.1, 7.3_

- [x] 4. Create `scripts/probe-glm.ts` — live-API probe (pre-push gate)
  - [x] 4.1 Write the script per design §9.2:
    - Read `process.env.ZAI_API_KEY`; exit code 1 with `"PROBE FAIL: ZAI_API_KEY not set"` if missing
    - Import `callZai` from `../src/lib/research-engine/engines/zai-client.ts` (use relative path; script lives at repo root in `scripts/`)
    - Invoke with: `model: 'glm-4.6'`, single user message `'搜索最近一周中国跨境电商合规政策热点，返回 JSON 形如 {topics: [{topic, keywords, voice_volume}]}，最多 3 条。'`, `timeoutMs: 60_000`, `jsonMode: true`, `searchRecency: 'oneWeek'`, `contentSize: 'medium'`, `errorContext: { engine: 'kimi', stage: 'hot-radar-scan' }`
    - On `ok:true`, assert all three: `result.ok === true`, `result.searchReferences.length >= 1`, `typeof result.data === 'object' && result.data !== null`
    - On pass: `console.log` exactly `` `PROBE PASS: glm-4.6 single-call web_search + json_object works; got ${n} refs` `` and `process.exit(0)`
    - On fail: `console.error` `` `PROBE FAIL: ${errorClass}: ${message}` `` and `process.exit(1)`
  - [x] 4.2 Decide the runner. Check `package.json` — `tsx` is not a direct dependency but is transitively available via Next; prefer `npx tsx scripts/probe-glm.ts`. If `npx tsx` fails to resolve, fall back to installing tsx as a devDep (`npm install --save-dev tsx`) or using `npx ts-node --transpile-only scripts/probe-glm.ts`. Document the chosen command at the top of the script as a comment.
  - [x] 4.3 **FIRST LIVE PROBE** — run the probe with the real key:
    ```powershell
    npx tsx scripts/probe-glm.ts
    ```
    Expected output: `PROBE PASS: glm-4.6 single-call web_search + json_object works; got N refs` where `N >= 1`, exit code 0.
  - [x] 4.4 **If the probe fails — STOP.** Do not proceed to task 5. Investigate:
    - Capture the full error message + HTTP status if any
    - Compare the actual 4xx/5xx body with the design §5 request-body shape (especially `enable:'True'` vs `enable:true`, `thinking: { type: 'disabled' }` acceptance, tool shape)
    - Consult the user with findings; the fix is either in `zai-client.ts` (shape) or in the key (permissions) — NOT in proceeding
    - Re-run 4.3 until PROBE PASS
  - _Requirements: 7.2, 1.4, 1.5, 1.6_

- [x] 5. Update `src/lib/research-engine/engines/loop.ts`
  - [x] 5.1 Replace the import `import { callQwen } from './qwen-client';` with `import { callZai } from './zai-client';`
  - [x] 5.2 Change `ResearcherProvider` union: `'openrouter' | 'moonshot' | 'qwen'` → `'openrouter' | 'moonshot' | 'zai'`
  - [x] 5.3 Rename `EngineLoopConfig.qwenApiKey?: string` → `zaiApiKey?: string` (keep optional modifier and comment updated: `/** Required when researcherProvider === 'zai'. */`)
  - [x] 5.4 In `callResearcher`, replace the entire `if (config.researcherProvider === 'qwen') { ... }` branch with a `'zai'` branch:
    - Guard: `if (!config.zaiApiKey)` → return `ServerError` with message `'researcherProvider=zai but zaiApiKey is missing'`
    - Derive `searchRecency` and `contentSize` from `p.stage`:
      - `p.stage === 'hot-radar-scan'` → `searchRecency: 'oneWeek'`, `contentSize: 'medium'`
      - `p.stage === 'deep-dive'` → `searchRecency: 'oneMonth'`, `contentSize: 'high'`
      - otherwise → both undefined (other stages don't route through zai in practice, but be defensive)
    - Call `callZai<T>({ model: config.researcherModel, messages: p.messages, apiKey: config.zaiApiKey, timeoutMs: p.timeoutMs, jsonMode: true, searchRecency, contentSize, errorContext: { engine: config.engineLabel, stage: p.stage, topicIndex: p.topicIndex } })`
    - On ok: return `{ ok: true, data: result.data, searchReferences: result.searchReferences }` (same shape as moonshot branch)
  - [x] 5.5 Run `getDiagnostics` on `src/lib/research-engine/engines/loop.ts` — zero errors
  - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2_

- [x] 6. Update `src/lib/research-engine/engines/kimi.ts`
  - [x] 6.1 Change `const DEFAULT_RESEARCHER_MODEL = 'qwen3.5-plus';` → `const DEFAULT_RESEARCHER_MODEL = 'glm-4.6';`
  - [x] 6.2 Rewrite the big docblock above `DEFAULT_RESEARCHER_MODEL` (the "Why qwen3.5-plus" block) to document the Zhipu GLM rationale instead:
    - History line: add `- 2026-05-02: switched Engine B from Alibaba Qwen direct to Zhipu GLM (glm-4.6) via z.ai after Qwen's hybrid-thinking constraints proved unworkable with non-streaming + enable_search. GLM has no such constraint — single-call architecture with web_search + json_object in one HTTP request.`
    - Rationale paragraphs: cite `glm-4.6`'s documented strength in "tool using and search-based agents"; 6+ months in production (released 2025-09); same price tier as 4.7/5.1 so "go latest" offers no advantage over proven; one-line upgrade path to newer SKUs if quality insufficient
    - Refs line: `https://docs.z.ai/guides/tools/web-search`
  - [x] 6.3 In `KimiLoopInput` interface, rename `qwenApiKey: string` → `zaiApiKey: string`; update its doc comment to `/** z.ai (Zhipu) key — used for Stage 1/2 research via callZai. */`
  - [x] 6.4 In `runKimiLoop`, change `researcherProvider: 'qwen'` → `researcherProvider: 'zai'` and `qwenApiKey: input.qwenApiKey` → `zaiApiKey: input.zaiApiKey`
  - [x] 6.5 Update the top-of-file docblock: change `Engine B — Alibaba Qwen direct via DashScope with enable_search.` to `Engine B — Zhipu GLM (glm-4.6) direct via z.ai with web_search tool.`; add a brief "2026-05-02" entry to the Historical notes list
  - [x] 6.6 Run `getDiagnostics` on `src/lib/research-engine/engines/kimi.ts` — zero errors
  - _Requirements: 3.1, 4.1, 4.2, 6.1, 6.3, 6.5, 12.8_

- [x] 7. Update `src/lib/inngest/functions/generate-report.ts`
  - [x] 7.1 Find the block that reads `process.env.DASHSCOPE_API_KEY` (inside the `fetch-config` step). Rename the `const qwenApiKey = process.env.DASHSCOPE_API_KEY;` line to `const zaiApiKey = process.env.ZAI_API_KEY;`
  - [x] 7.2 Update the error message: `'DASHSCOPE_API_KEY is not set — Engine B requires direct Alibaba Qwen access for enable_search'` → `'ZAI_API_KEY is not set — Engine B requires Zhipu GLM access for web_search'`
  - [x] 7.3 Rename the returned-object field `qwenApiKey` → `zaiApiKey` in the `return { ... }` at the bottom of `fetch-config`
  - [x] 7.4 In the `runKimiLoop({ ... })` call inside the `Promise.all`, change `qwenApiKey: config.qwenApiKey` → `zaiApiKey: config.zaiApiKey`
  - [x] 7.5 Run `getDiagnostics` on `src/lib/inngest/functions/generate-report.ts` — zero errors
  - _Requirements: 5.1, 5.2_

- [x] 8. Update `src/types/scheduled-runs.ts`
  - [x] 8.1 In `EngineSearchReference.provider`, change the union `'moonshot' | 'qwen' | 'openrouter-exa'` → `'moonshot' | 'zai' | 'openrouter-exa'`
  - [x] 8.2 In `ResearchEngineInput`, rename `qwenApiKey?: string` → `zaiApiKey?: string`; update its doc comment to reference Zhipu GLM instead of Qwen (text like `/** Required when Engine B is configured with researcherProvider='zai' (which is now the default). Tests that exercise only legacy OpenRouter paths may omit it and use a dummy value. */`)
  - [x] 8.3 Run `getDiagnostics` on `src/types/scheduled-runs.ts` — zero errors
  - _Requirements: 4.3, 6.2_

- [x] 9. Update `src/lib/research-engine/index.ts`
  - [x] 9.1 In the `runKimiLoop({ ... })` call inside `run()`, change `qwenApiKey: input.qwenApiKey ?? ''` → `zaiApiKey: input.zaiApiKey ?? ''`
  - [x] 9.2 Run `getDiagnostics` on `src/lib/research-engine/index.ts` — zero errors
  - _Requirements: 5.1_

- [x] 10. Delete `qwen-client.ts` and its test file
  - [x] 10.1 Delete `src/lib/research-engine/engines/qwen-client.ts`
  - [x] 10.2 Delete `src/lib/research-engine/engines/__tests__/qwen-client.test.ts`
  - [x] 10.3 Run `grepSearch` across `src/**` for `callQwen`, `qwen-client`, `qwenApiKey`, and `DASHSCOPE_API_KEY` — expect zero hits in production code. If any hit surfaces, fix it before proceeding.
  - _Requirements: 5.4, 7.4_

- [x] 11. Full build + test suite verification (pre-probe gate)
  - [x] 11.1 Run `npm run build` — expect zero TypeScript errors. Any error here is a rename miss from tasks 5-9; fix before proceeding.
  - [x] 11.2 Run `npx vitest run src/lib/research-engine/` — expect all engine tests pass (Moonshot tests unchanged; zai 9/9; no qwen tests to run since deleted). If any Moonshot test fails, something leaked beyond scope — investigate.
  - [x] 11.3 Run `git diff --stat` — verify the file list matches design §4 file diff map exactly:
    - CREATE: `src/lib/research-engine/engines/zai-client.ts`, `src/lib/research-engine/engines/__tests__/zai-client.test.ts`, `scripts/probe-glm.ts`
    - MODIFY: `src/lib/research-engine/engines/kimi.ts`, `src/lib/research-engine/engines/loop.ts`, `src/lib/inngest/functions/generate-report.ts`, `src/lib/research-engine/index.ts`, `src/types/scheduled-runs.ts`
    - DELETE: `src/lib/research-engine/engines/qwen-client.ts`, `src/lib/research-engine/engines/__tests__/qwen-client.test.ts`
    - No other files should be modified. If they are, investigate.
  - _Requirements: 7.2, 6.7, 12.1-12.10_

- [x] 12. **FINAL PRE-PUSH PROBE** (mandatory, per Q10)
  - [x] 12.1 Re-run `npx tsx scripts/probe-glm.ts` with the same `ZAI_API_KEY` env var set — expect `PROBE PASS`, exit code 0
  - [x] 12.2 **If it fails — STOP.** Do NOT commit. Do NOT push. Investigate per task 4.4. This re-run is the last safety net before the change goes live.
  - _Requirements: 7.2_

- [-] 13. Commit (no push yet)
  - [ ] 13.1 `git add -A` to stage new, modified, and deleted files in one shot
  - [ ] 13.2 `git status` — confirm the staged file list matches design §4 (same check as 11.3, but on staged set)
  - [ ] 13.3 Create commit with this message:
    ```
    Swap Engine B backend from Qwen (DashScope) to Zhipu GLM (z.ai)

    - New: zai-client.ts (single-call web_search + json_object, glm-4.6)
    - New: scripts/probe-glm.ts (live-API pre-push gate)
    - Renamed env/config: DASHSCOPE_API_KEY -> ZAI_API_KEY; qwenApiKey -> zaiApiKey
    - Renamed ResearcherProvider member: 'qwen' -> 'zai'
    - Deleted: qwen-client.ts + test (zero consumers after swap)
    - Preserved: kimi.ts filename, runKimiLoop export, DB column kimi_output,
      EngineAssembledContent shape, 4-stage structure, stage timeouts,
      Engine A / Moonshot / OpenRouter paths

    Closes engine-b-glm-replacement spec.
    ```
  - [ ] 13.4 Run `git show --stat HEAD` to display commit summary as a sanity check
  - _Requirements: n/a (mechanical)_

- [ ] 14. **Ask user before pushing** (GATE)
  - [ ] 14.1 Use the `userInput` tool to ask: `"Local probe passed; build green; tests 9/9; commit staged. Push to origin/main now? (yes / no / show diff)"`
  - [ ] 14.2 WAIT for user confirmation. Do not push without an explicit "yes" or equivalent. If user asks to see the diff, show `git show HEAD` output first.
  - _Requirements: safety_guardrails (git-push-to-main)_

- [ ] 15. Push to origin/main
  - [ ] 15.1 `git push origin main` (user already confirmed in task 14)
  - [ ] 15.2 `git log origin/main -1` to confirm the new commit is on the remote
  - [ ] 15.3 Tell the user: "Wait for Vercel to mark the new deployment as Ready AND Current/Production on the Deployments page. Vercel auto-deploys on push; typical time 2-4 minutes."
  - _Requirements: n/a (mechanical)_

- [ ] 16. Wait for Vercel Ready + Current (user action)
  - [ ] 16.1 (user action) Open Vercel → Deployments, wait for the new commit to show Ready AND Current (Production)
  - [ ] 16.2 Ask user via `userInput`: `"Is the new commit showing Ready AND Current on the Vercel Deployments page?"`
  - [ ] 16.3 If user says "not Current yet", advise: (a) some Vercel projects require clicking "Promote to Production" on the Ready deployment, (b) an empty commit `git commit --allow-empty -m "Trigger redeploy" && git push` can force a fresh deploy if the Ready one got stuck. Wait for Current before proceeding.
  - _Requirements: deploy-pipeline gate (per verification-before-completion.md)_

- [ ] 17. Clean DB + trigger manual run (user action)
  - [ ] 17.1 (user action) In Supabase SQL Editor, clear existing queued/running rows so the manual trigger isn't deduped:
    ```sql
    DELETE FROM scheduled_runs WHERE status IN ('queued', 'running');
    ```
    (Design note: this targets only in-flight rows, not historical succeeded/failed runs — preserves audit trail. If user wants a fully clean slate they can `DELETE FROM scheduled_runs;` but this is not required.)
  - [ ] 17.2 (user action) Open `/admin/scheduled-runs`, click "Trigger now" for the test domain
  - [ ] 17.3 (user action) Record the trigger time (HH:MM) in chat so we can correlate with Inngest logs
  - _Requirements: 8.1_

- [ ] 18. Wait 5-10 minutes, then collect evidence (user action)
  - [ ] 18.1 (user action) Wait until Inngest dashboard shows the run as Completed (or Failed)
  - [ ] 18.2 (user action) Run this SQL and paste the result into chat:
    ```sql
    SELECT id,
           status,
           duration_ms / 1000.0 AS duration_sec,
           (kimi_output -> 'assembled') IS NOT NULL AS b_ok,
           COALESCE(jsonb_array_length(kimi_output -> 'searchReferences'), 0) AS b_refs,
           kimi_output -> 'errors' -> 0 ->> 'errorClass' AS b_err_class,
           substring(kimi_output -> 'errors' -> 0 ->> 'message', 1, 300) AS b_err_msg,
           (gemini_output -> 'assembled') IS NOT NULL AS a_ok,
           COALESCE(jsonb_array_length(gemini_output -> 'searchReferences'), 0) AS a_refs,
           triggered_at
    FROM scheduled_runs
    ORDER BY triggered_at DESC
    LIMIT 1;
    ```
  - [ ] 18.3 (user action) Also paste the Inngest `engine-kimi-stage1-hot-radar` step output (first 50 lines) so we can see the first live callZai response envelope
  - _Requirements: 8.1, 8.2_

- [ ] 19. Interpret results → close spec OR rollback
  - [ ] 19.1 **PASS case**: `status='succeeded' AND b_ok=true AND b_refs >= 3 AND b_err_class IS NULL`.
    - Tell user: 🎉 GLM swap verified. Remind user to delete `DASHSCOPE_API_KEY` from Vercel Environment Variables now (per design §8 / Q8) — the Tier 1 rollback window is closed.
    - Proceed to task 20.
  - [ ] 19.2 **FAIL case — new error class** (`b_err_class` is neither empty nor a known-thinking-mode artifact): investigate the specific error per design §6 error table. The most likely fixes are shape-level inside `zai-client.ts` (field name mismatch, `'True'` vs `true`, `thinking` shape). Ask user for full Inngest log before pushing a patch.
  - [ ] 19.3 **FAIL case — timeout / rate-limit**: design §10 risk table predicts this. Tell user — this is a known risk, remediation is retry tuning or Stage 2 concurrency semaphore (out of scope for this spec). Do not rollback on this alone; rerun once and watch.
  - [ ] 19.4 **FAIL case — complete engine failure** (`status='failed'` or `b_ok=false` with opaque server error): walk through Rollback Tier 1 per design §8:
    - `git revert <commit-sha>` → `git push origin main` → Vercel auto-redeploys
    - Since `DASHSCOPE_API_KEY` is still live in Vercel (not yet deleted per task 19.1), the reverted code finds its credential and returns to the previous-broken-Qwen baseline (which still lets Engine A + Synthesizer produce a single-source report per design §8 Tier 1)
    - Ask user to re-run task 17-18 on the reverted code to confirm rollback succeeded
    - Investigate the GLM failure on a branch, not on main
  - _Requirements: 8.3, 9.3_

- [ ] 20. Final checkpoint — declare spec complete (per verification-before-completion.md)
  - Only close the spec when ALL of these gates are green:
    - ✓ `npm run build` zero errors (task 11.1)
    - ✓ zai-client unit tests 9/9 pass (task 11.2)
    - ✓ Diff scope matches design §4 file diff map (task 11.3)
    - ✓ Local live probe PASS (task 12)
    - ✓ Commit pushed, Vercel Ready + Current on new commit (task 16)
    - ✓ Post-deploy SQL shows `status='succeeded'`, `b_ok=true`, `b_refs >= 3`, `b_err_class IS NULL` (task 18.2)
    - ✓ User deleted `DASHSCOPE_API_KEY` from Vercel (task 19.1)
  - Produce the "done" message using the template from verification-before-completion.md:
    ```
    Pushed <commit-sha>.

    What I verified:
    - Local live probe: PROBE PASS with N refs returned
    - npm run build: zero errors
    - zai-client.test.ts: 9/9 pass
    - Post-deploy SQL: status=succeeded, b_ok=true, b_refs=<count>
    - Vercel: commit Ready and Current on Production

    What YOU need to do for full activation:
    - Delete DASHSCOPE_API_KEY from Vercel Environment Variables (rollback window closed)

    How to confirm it worked:
    - /admin/scheduled-runs — next scheduled run (or manual trigger) shows a draft report with citations from CN-community sources
    - The draft report, opened in /reports/[id], renders the Account Health + Listing modules with evidence from recent Zhipu-search results

    If it still misbehaves, send me:
    - SQL from task 18.2 with the latest row
    - Full Inngest step log for engine-kimi-stage1-hot-radar
    ```
  - _Requirements: all final gates_

## Notes

- No tasks marked optional (`*`) in this spec. Every task is a required link in the chain: skipping any of tasks 2-13 breaks the atomic-PR contract; skipping any of tasks 14-20 breaks the pre-push / post-deploy verification gates that are the whole lesson of the Qwen debugging cycle.
- The live-API probe (tasks 4 and 12) is the spec's most important innovation over the Qwen cycle. Mocks proved insufficient last time — the probe is the structural fix for that category of failure.
- Principle 1 (time doesn't matter) applies — the 300s Stage 1 timeout in `loop.ts` is unchanged; do not optimize for speed during verification.
- Principle 2 (prompt engineering is last resort) applies — the design uses `response_format: json_object` (API constraint) as the primary reliability mechanism; do not add prompt-level "return only JSON" pleas inside `zai-client.ts`.
- Principle 3 (bilingual) is not impacted — Engine B emits Chinese content, the translation layer downstream is unchanged.
- No property-based tests in this spec: the design document does not include a "Correctness Properties" section (this is an integration / API-shape swap, not an algorithmic feature), so unit tests are the correct test layer per the workflow guidance.
