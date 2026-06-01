---
inclusion: always
---

# Workflow Discipline

One connected workflow for any non-trivial change: **plan first**, confirm **content design** with the user before writing user-facing content, then **verify** end-to-end before claiming done. These three were separate steering files; they are sequential stages of the same loop, so they live together here. Plan is upstream of content-design review, which is upstream of verification.

---

## Plan Before Coding

When a task is non-trivial (2+ files touched, or touches external systems
like Supabase / Inngest / OpenRouter / Vercel deployment config), write a
short plan and get user sign-off BEFORE modifying any code.

Adapted from obra/superpowers `writing-plans`, simplified for this project.

### When to plan

**Required** for:
- Multi-file refactors (touching 2+ files)
- External system integrations (Inngest config, Supabase RLS/migrations, 
  Vercel env vars, OpenRouter model changes)
- Schema changes (scheduled_runs / reports / any DB table)
- New prompts or prompt structural changes (engine loop reshape, new stages)
- Any change that would require Inngest resync or Supabase migration

**Not required** for:
- Typo fixes
- One-line bug fixes in a function with a clear contract
- Renaming a variable / tidying imports
- Writing a test

### Plan format (keep short)

```
Goal: [one sentence]

Files to change:
- path/to/file1.ts — [what changes, one line]
- path/to/file2.tsx — [what changes, one line]

External side-effects:
- Inngest: needs resync? yes/no
- Supabase: migration needed? yes/no — file name if yes
- Vercel: env var changes? yes/no
- DB: new data shape? (before/after)

Verification (what proves it works, ran by me before claiming done):
- [one concrete check]
- [another concrete check]

Rollback (if it goes wrong):
- [one line — usually "revert commit X"]

Risks I see:
- [anything non-obvious]
```

Target length: 15-25 lines. If the plan itself is longer, the task is
big enough to warrant a full spec in `.kiro/specs/`.

### Workflow

1. After understanding the request, produce the plan (do NOT jump to code).
2. Present the plan to the user in chat.
3. Wait for "OK" / "开始" / "go" — or changes. Accept changes, revise plan.
4. Once approved, execute the plan **in order**, one file at a time when
   changes are coupled.
5. Do NOT add scope mid-execution. If you discover a new needed change,
   stop, amend the plan, get re-approval.

### Anti-patterns (do NOT do these)

- Plan after code is written ("here's what I did")
- Plan without verification steps
- Plan that says "update the prompt" without quoting the exact new text
- Over-plan trivial tasks (a 1-line fix doesn't need a 20-line plan)

### Integration with existing steering

- This is upstream of the **Content Design Review** section below — if the task involves
  user-facing content, content design review still applies on TOP of
  the plan (I show prompt/field text for confirmation BEFORE writing code).
- This is upstream of the **Verification Before Completion** section below — the
  "Verification" section of the plan becomes the checklist I run before
  declaring done.
- Karpathy `simplicity first` still wins — if a plan has 20 steps for
  a problem that needs 3, collapse the plan.

---

## Content Design Review Rule

When implementing features that involve user-facing content design, ALWAYS confirm with the user BEFORE writing code. This includes:

- Form fields: what fields to include, which are required vs optional, default values
- Dropdown options: what choices to offer in select menus
- Page structure: what sections to show, their order, and layout
- LLM prompts: what instructions to give AI for content generation/formatting
- Navigation: what links to add and where
- Email templates: what content to include in automated emails
- News/report structure: what modules, categories, or labels to use

### Process
1. Propose the content design (fields, options, structure) to the user
2. Wait for user confirmation or feedback
3. Only then proceed with implementation

This avoids rework from assumptions about domain-specific content that the user knows best.

---

## Verification Before Completion

Before claiming a task is "done" / "complete" / "push 完了" / "可以了", run
an explicit verification pass. "Build passed + zero diagnostics" is NOT
enough. Prove the change actually works end-to-end.

Adapted from obra/superpowers `verification-before-completion`, tailored to
this Next.js + Supabase + Inngest + Vercel stack.

### The minimum verification bar

Before declaring done, I must be able to answer YES to every applicable question:

#### For code changes
- [ ] `getDiagnostics` on all modified files returns zero errors
- [ ] If `package.json` / imports / build-time code changed: `npm run build` passes
- [ ] If unit tests exist for this area: tests pass
- [ ] Plan's "Verification" section (from the **Plan Before Coding** section above) is executed, 
      not just defined

#### For external system changes
- [ ] **Vercel**: latest commit shows "Ready" on Deployments page (if user can check)
- [ ] **Inngest**: if function config (steps, idempotency, triggers, concurrency) 
      changed, user has done Resync. ALWAYS tell the user when resync is required.
- [ ] **Supabase**: if migration added, user has run it in SQL Editor. ALWAYS
      tell the user when a migration needs to run.
- [ ] **Env vars**: if a new `process.env.X` added, user has set it in Vercel 
      + redeployed. ALWAYS remind.

#### For DB writes
- [ ] The expected row shows up in DB (verifiable via a SQL snippet I provide)
- [ ] The row's key columns match expected values (not just "not null")

#### For user-facing output (report content, UI)
- [ ] I can describe concretely what the user should see after the change
- [ ] I've told the user where to look (URL / page / DB row)

### Honesty checklist

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

### The "done" message template

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

### Anti-patterns

- "done" without running diagnostics
- "done" without triggering the flow if possible
- Claiming Vercel / Inngest sync when you don't control the deployment
- Declaring success based on "should work" reasoning
- Glossing over migration / resync requirements
- Asking the user to check 3 things without saying which failure means what

### Integration with existing steering

- `debugging-discipline.md` Rule 2: "verify most recent deployed code is 
  running" — this is the OTHER HALF of the same rule, applied to NEW work.
  Debugging discipline asks "is the right code live?"; verification asks 
  "does the live code do what it should?"
- **Plan Before Coding** (above): the plan's "Verification" section is the 
  contract. This section EXECUTES that contract.
- Karpathy "Evidence over claims" — this steering is basically that rule 
  operationalized for this project's external systems.
