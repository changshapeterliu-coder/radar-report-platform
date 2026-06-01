---
inclusion: always
---

# Deployment & Environment

How this project is deployed and the constraints that come with it. Two parts: the **compatibility rules** to write code that builds and runs on the current stack, and the **environment-variable inventory** so the agent never re-asks whether a key is configured. Merged from the former `tech-environment-compatibility` and `vercel-env-vars` steering files.

---

## Tech Environment Compatibility Rule

When writing code, ALWAYS consider the deployment environment constraints to avoid build failures. This project is deployed on Vercel with specific version constraints.

### Project Environment

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Runtime**: Node.js on Vercel serverless
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v4
- **Database**: Supabase (PostgreSQL) with Row Level Security
- **Deployment**: Vercel (free/hobby tier)
- **Infrastructure options**: AWS is available for this work — an AWS account can be provisioned, and Bedrock (Claude family) is the default model gateway inside Amazon. Current deployment is still Vercel + third-party LLM providers; AWS-native (Bedrock, Lambda) is an available path, not the current state. Prefer it when a change touches real seller data or needs to keep data inside Amazon-owned infrastructure. Treat a move to Bedrock as an architecture decision (see MEMORY.md), not a code tweak.

### Critical Compatibility Constraints

#### TypeScript / Regex

- **DO NOT use regex `/s` dotAll flag** — use `[\s\S]` instead
- **DO NOT use regex lookbehind assertions** `(?<=...)` or `(?<!...)` unless ES2018+ is confirmed
- Avoid modern regex features (named groups, unicode property escapes) unless necessary
- Prefer simple, well-supported regex patterns

#### JavaScript Features

- Avoid top-level `await` in module scope
- Avoid decorators (not stable in TS config)
- Use `String.prototype.replaceAll` carefully (requires ES2021+)
- Check `Array.prototype.at`, `Object.hasOwn`, etc. before using

#### Next.js 16 Specifics

- `middleware.ts` is renamed to `proxy.ts` — always use `src/proxy.ts`
- Server Components cannot use client-only APIs (localStorage, window)
- Route handlers must return `NextResponse` or `Response`
- Dynamic route params are Promises in Next.js 16: `params: Promise<{ id: string }>` then `const { id } = use(params)`
- `'use client'` must be at the top of the file if using hooks/state

#### Serverless Environment Limits

- **No long-running processes** — Vercel hobby tier: 10s max execution, pro: 60s max
- **No file system writes** beyond `/tmp`
- **No persistent memory** between requests
- AI operations that might take > 10s should be wrapped in try/catch and run in background
- Never rely on setInterval / setTimeout for scheduled tasks — use Vercel Cron or Supabase Edge Functions

#### Supabase / Database

- **RLS is enforced by default** — every new table needs RLS policies
- **Use `.limit(1)` instead of `.single()`** when unsure if row exists or is unique (`.single()` throws if 0 or >1 rows)
- Service role key should ONLY be used in server-side API routes, never exposed to client
- JSONB columns are fine but complex queries on them need GIN indexes

#### Third-Party API Constraints

- **OpenRouter**: some models don't support `response_format: { type: 'json_object' }` — handle markdown code fences in response parsing
- **Gemini**: rate limits on free tier — always wrap in try/catch with fallback
- **Resend**: free tier only sends to verified domains — use in-app notifications as primary, email as backup

#### Tailwind v4 / CSS

- No arbitrary values with complex expressions inside `@apply`
- Use CSS custom properties for dynamic theme values
- Chinese font stack should include `"Microsoft YaHei"`, `"微软雅黑"`, with fallbacks

#### Build-Time vs Runtime

- Environment variables prefixed `NEXT_PUBLIC_` are exposed to client
- Server-only secrets (API keys, service role key) must NOT have this prefix
- `process.env` access in client components is inlined at build time — restart deployment after changing

### Development Workflow

- Always run `getDiagnostics` on modified files before committing
- Watch for TypeScript errors (strict mode enforces them)
- Test edge cases: empty arrays, null values, missing fields
- When adding new files referencing external APIs, add the env var check at the top

### Common Mistakes to Avoid

- `Array.prototype.toSorted` / `Array.prototype.toReversed` (ES2023)
- `structuredClone` without Node 17+ confirmation
- Regex features beyond ES2017 without explicit TS target bump
- Client-side code using `fs`, `path`, `crypto.randomBytes`
- Importing server components into client components
- Using `await` inside JSX expressions

### When in Doubt

- Prefer the older, more compatible approach unless there's a clear benefit
- Test build locally with `npm run build` before pushing if unsure
- Check existing code in the repo for the pattern being used


### Quality Override Protocol

**When a compatibility constraint would significantly compromise feature quality, user experience, or functional correctness — STOP and consult the user BEFORE applying a workaround.**

Examples of when to consult:
- Environment-forced workaround would make the UX visibly worse (slower, less interactive, fewer features)
- Constraint would prevent implementing the user's stated requirement
- Compatible alternative exists but produces lower-quality output
- Performance trade-off is non-trivial (e.g., serverless 10s limit forces sync → async refactor affecting UX)
- A paid tier / alternative service would solve the problem cleanly

Consultation format:
1. Briefly explain the constraint encountered
2. Present 2-3 options (compatible-but-degraded / upgrade-path / alternative-service)
3. State the trade-offs for each
4. Ask user to decide

Do NOT silently downgrade quality to stay within constraints. The user values quality and wants to make informed choices about when to accept limits vs. invest in upgrades.

---

## Vercel Environment Variables — Inventory

The Vercel project for this app (`radar-report-platform`) already has every
secret/key the codebase needs. **Don't ask the user to confirm whether a key
is configured.** Assume it is. If a deploy actually fails because of a
missing env var, the runtime error will say so — surface that error
directly, don't preemptively interrogate.

Snapshot taken from the Vercel dashboard (Project → Environment Variables):

### Configured in Production + Preview (and most also All-Environments)

#### LLM / AI provider keys
- `OPENROUTER_API_KEY` — OpenRouter, default LLM gateway. Used by
  publish-time topic stabilization, AI Insight news, format-report,
  translate-report, daily-alert pipeline, etc.
- `ZAI_API_KEY` — Z.ai (GLM) — engine B in research-engine.
- `MOONSHOT_API_KEY` — Moonshot / Kimi — engine in research-engine.
- `DASHSCOPE_API_KEY` — Alibaba DashScope (Qwen) — research-engine engine.

#### Supabase
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, bypasses RLS. Used by
  Inngest functions and admin API routes.

#### Inngest
- `INNGEST_EVENT_KEY` (Production + Preview)
- `INNGEST_SIGNING_KEY` (Production + Preview)

#### Email
- `RESEND_API_KEY`
- `ADMIN_EMAIL`

### Implications for the agent

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

### Maintenance

If the user adds/removes a Vercel env var, update this file in the same
turn. This list is the single source of truth the agent reads — keeping it
fresh is what avoids the "did you configure X?" loop the user explicitly
asked us to stop doing.
