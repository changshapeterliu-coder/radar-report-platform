# Verification Before Completion

Before claiming a task is "done" / "complete" / "push 完了" / "可以了", run
an explicit verification pass. "Build passed + zero diagnostics" is NOT
enough. Prove the change actually works end-to-end.

Adapted from obra/superpowers `verification-before-completion`, tailored to
this Next.js + Supabase + Inngest + Vercel stack.

## The minimum verification bar

Before declaring done, I must be able to answer YES to every applicable question:

### For code changes
- [ ] `getDiagnostics` on all modified files returns zero errors
- [ ] If `package.json` / imports / build-time code changed: `npm run build` passes
- [ ] If unit tests exist for this area: tests pass
- [ ] Plan's "Verification" section (from `plan-before-coding.md`) is executed, 
      not just defined

### For external system changes
- [ ] **Vercel**: latest commit shows "Ready" on Deployments page (if user can check)
- [ ] **Inngest**: if function config (steps, idempotency, triggers, concurrency) 
      changed, user has done Resync. ALWAYS tell the user when resync is required.
- [ ] **Supabase**: if migration added, user has run it in SQL Editor. ALWAYS
      tell the user when a migration needs to run.
- [ ] **Env vars**: if a new `process.env.X` added, user has set it in Vercel 
      + redeployed. ALWAYS remind.

### For DB writes
- [ ] The expected row shows up in DB (verifiable via a SQL snippet I provide)
- [ ] The row's key columns match expected values (not just "not null")

### For user-facing output (report content, UI)
- [ ] I can describe concretely what the user should see after the change
- [ ] I've told the user where to look (URL / page / DB row)

## Honesty checklist

Before typing "done" / "完成了" / "可以用了":

1. **Did I actually test the end-to-end flow?** Or am I assuming it works 
   because individual pieces compile? If only compiled, SAY SO:
   > "代码改完 build 过了，但端到端流程需要你触发 / Vercel 部署完才能验证。"

2. **What's the smallest test the user can do to confirm?** State it 
   explicitly. Examples:
   > "去 /admin/scheduled-runs 点 Trigger now → DB 里应该出现新行 status=running"
   > "在 SQL Editor 跑 `SELECT … FROM scheduled_runs ORDER BY triggered_at DESC LIMIT 1;` → status 应该是 succeeded"

3. **What external side-effects did I create that the user must manually 
   complete?** List them:
   - Migration file that needs running
   - Inngest config change that needs resync
   - Env var that needs setting
   - Prompt template that needs DB update

If any of these are outstanding, completion is CONDITIONAL — make that 
explicit to the user instead of "done".

## The "done" message template

When declaring a task complete, use this shape:

```
Pushed [commit hash].

What I verified:
- [concrete check 1]
- [concrete check 2]

What YOU need to do for full activation:
- [manual step 1, if any]
- [manual step 2, if any]

How to confirm it worked:
- [smallest smoke test the user can run]

If it still misbehaves, send me:
- [what diagnostic evidence I'll need]
```

Short, direct, honest. If there are zero "YOU need to do" items, omit that 
section. Never omit "what I verified" — claiming done without stating 
verification is a lie.

## Anti-patterns

- "done" without running diagnostics
- "done" without triggering the flow if possible
- Claiming Vercel / Inngest sync when you don't control the deployment
- Declaring success based on "should work" reasoning
- Glossing over migration / resync requirements
- Asking the user to check 3 things without saying which failure means what

## Integration with existing steering

- `debugging-discipline.md` Rule 2: "verify most recent deployed code is 
  running" — this is the OTHER HALF of the same rule, applied to NEW work.
  Debugging discipline asks "is the right code live?"; verification asks 
  "does the live code do what it should?"
- `plan-before-coding.md`: the plan's "Verification" section is the 
  contract. Verification-before-completion EXECUTES that contract.
- Karpathy "Evidence over claims" — this steering is basically that rule 
  operationalized for this project's external systems.
