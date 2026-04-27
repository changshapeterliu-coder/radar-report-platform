# Debugging Discipline

When debugging "X doesn't work" reports, follow these rules to avoid
wasteful guess-and-check cycles. Based on lessons from the retry/Inngest
sync incident where 3 code changes were pushed before the real cause
(Inngest function config cached server-side) was identified.

## Rule 1: Map the full call chain before touching code

For any "didn't work" symptom, draw the pipeline first:

```
UI click → frontend fetch → API handler → external service call
       → background function → DB write → UI refresh
```

For each hop, answer:
- **How do I prove this hop actually executed?**
- **What observable artifact does this hop leave behind?**

Example proofs:
- API returned 202 → toast color + HTTP status
- External service received the call → event list / dashboard
- Background function ran → function run trace
- DB write happened → SQL query result
- UI refreshed → row count in list

Never change code until you know exactly which hop is failing.

## Rule 2: Always verify the most recent deployed code is what's running

When a fix appears to not work, the first suspect is not your logic —
it is whether the new code is actually live. Check in order:

1. **Git push succeeded?** — `git log origin/main -1`
2. **CI/CD pipeline green?** — Vercel / GitHub Actions deployment status
3. **External service picked up the new config?** — Inngest sync,
   Supabase edge function redeploy, CDN cache invalidation
4. **Is there a warm instance still running old bundle?** — serverless
   providers sometimes serve cached bundles for 30-60s after Ready

Only after these are confirmed should you inspect the logic itself.

## Rule 3: External systems often cache configuration server-side

Common gotchas where "new code" does not equal "new behavior":

| System | What caches | How to refresh |
|---|---|---|
| Inngest | Function config (idempotency, concurrency, triggers) | Manual Resync in dashboard |
| Supabase | RLS policies, database functions | Re-run migration |
| Vercel | Env vars in build artifacts | Redeploy after env change |
| CloudFlare / Vercel Edge | Route cache | Purge cache or bump route |
| Browser | Client bundle, fetch responses | Hard refresh (Ctrl+Shift+R) |

When "I changed code but behavior is the same," first suspect is
server-side config cache, not your logic.

## Rule 4: Collect evidence once, not in N round trips

For a hairy bug, ask the user for a diagnostic bundle in a single turn:

- SQL query result from the relevant table
- External service dashboard screenshot (event list, function runs)
- HTTP response / toast content
- Deployment status + commit hash
- Browser console log (if relevant)

Batch requests save user time and let you cross-reference signals.
Never iterate "OK now check X" → "OK now check Y" when you could have
asked for both.

## Rule 5: Count signals and look for mismatches

Concrete example: "Inngest received 7 events, only 2 triggered function
runs" is a 71% dedup rate — a strong signal that function-level config
is dropping events. Just saying "function didn't run" loses this
detail.

When evidence has quantities, compare the numbers:
- Events sent vs events received vs functions triggered vs DB rows
- Mismatched counts point directly to the failing hop

## Rule 6: Resist the urge to "improve while debugging"

If your hypothesis is "config X is stale," the minimum fix is
"refresh config X" — not "rewrite the module that uses config X."
The latter makes future debugging harder (more variables changed at
once) and often doesn't actually fix the bug.

Commit one change at a time. Verify the symptom changes. If it doesn't,
revert before trying the next hypothesis.

## Rule 7: User non-technical ≠ user info incomplete

A non-technical user can still provide exact evidence (screenshots,
SQL output, timestamps). If evidence seems incomplete, ask pointed
questions that return verifiable data, e.g.:

- "Is the toast after retry green or red?"
- "Go to Supabase SQL Editor, paste this query, send me the result:
  `SELECT …`"
- "In Inngest dashboard, most recent event for `report/...` —
  is 'Functions triggered' column empty or does it show a function name?"

Clear, specific questions produce clear answers.

## Red Flags That Mean Stop And Re-plan

- You've pushed 3+ code changes and the symptom is unchanged
- Each attempted fix was a different hypothesis
- You haven't verified the new code is deployed / live
- You're making assumptions based on "it should work"

When any of these hit, stop. Go back to Rule 1: re-draw the call chain
and pick the next hop you haven't actually verified.
