---
inclusion: always
---

# Vercel Environment Variables — Inventory

The Vercel project for this app (`radar-report-platform`) already has every
secret/key the codebase needs. **Don't ask the user to confirm whether a key
is configured.** Assume it is. If a deploy actually fails because of a
missing env var, the runtime error will say so — surface that error
directly, don't preemptively interrogate.

Snapshot taken from the Vercel dashboard (Project → Environment Variables):

## Configured in Production + Preview (and most also All-Environments)

### LLM / AI provider keys
- `OPENROUTER_API_KEY` — OpenRouter, default LLM gateway. Used by
  publish-time topic stabilization, AI Insight news, format-report,
  translate-report, daily-alert pipeline, etc.
- `ZAI_API_KEY` — Z.ai (GLM) — engine B in research-engine.
- `MOONSHOT_API_KEY` — Moonshot / Kimi — engine in research-engine.
- `DASHSCOPE_API_KEY` — Alibaba DashScope (Qwen) — research-engine engine.

### Supabase
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, bypasses RLS. Used by
  Inngest functions and admin API routes.

### Inngest
- `INNGEST_EVENT_KEY` (Production + Preview)
- `INNGEST_SIGNING_KEY` (Production + Preview)

### Email
- `RESEND_API_KEY`
- `ADMIN_EMAIL`

## Implications for the agent

- Treat any `process.env.<KEY>` from the list above as **available at
  runtime in Vercel**. Don't suggest "you might be missing this key" as a
  hypothesis unless a deployment log explicitly says so.
- Treat `.env.local` as the developer's local mirror — same keys, same
  values, used for local `npm run dev` and one-off scripts (`npm run
  backfill:*`).
- When adding a new third-party provider that needs a new env var, **do
  flag it explicitly** ("you'll need to add `NEW_THING_API_KEY` to Vercel
  before this deploys") and update this file.
- When debugging a "feature didn't work in production" issue, env-var
  presence is *not* the first hypothesis. Logging, RLS, deploy freshness,
  Inngest sync are higher-prior suspects.

## Maintenance

If the user adds/removes a Vercel env var, update this file in the same
turn. This list is the single source of truth the agent reads — keeping it
fresh is what avoids the "did you configure X?" loop the user explicitly
asked us to stop doing.
