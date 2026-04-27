# Plan Before Coding

When a task is non-trivial (2+ files touched, or touches external systems
like Supabase / Inngest / OpenRouter / Vercel deployment config), write a
short plan and get user sign-off BEFORE modifying any code.

Adapted from obra/superpowers `writing-plans`, simplified for this project.

## When to plan

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

## Plan format (keep short)

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

## Workflow

1. After understanding the request, produce the plan (do NOT jump to code).
2. Present the plan to the user in chat.
3. Wait for "OK" / "开始" / "go" — or changes. Accept changes, revise plan.
4. Once approved, execute the plan **in order**, one file at a time when
   changes are coupled.
5. Do NOT add scope mid-execution. If you discover a new needed change,
   stop, amend the plan, get re-approval.

## Anti-patterns (do NOT do these)

- Plan after code is written ("here's what I did")
- Plan without verification steps
- Plan that says "update the prompt" without quoting the exact new text
- Over-plan trivial tasks (a 1-line fix doesn't need a 20-line plan)

## Integration with existing steering

- This is upstream of `content-design-review.md` — if the task involves
  user-facing content, content design review still applies on TOP of
  the plan (I show prompt/field text for confirmation BEFORE writing code).
- This is upstream of `verification-before-completion.md` — the
  "Verification" section of the plan becomes the checklist I run before
  declaring done.
- Karpathy `simplicity first` still wins — if a plan has 20 steps for
  a problem that needs 3, collapse the plan.
