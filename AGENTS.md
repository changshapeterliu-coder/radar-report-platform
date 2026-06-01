# AGENTS.md — Radar Report Platform

Source of truth for any AI agent (or new partner) working in this repo. Behavior rules live in `.kiro/steering/`; per-feature plans live in `.kiro/specs/`; long-term decisions live in `MEMORY.md`. This file is the architecture + onboarding map. Keep it lean and current.

## What it is

A platform that generates deep, cited compliance "radar reports" for the WWGS Seller Compliance AM team — account health and compliance trends for China-based Amazon sellers. Reports run on a schedule or on demand, in the background; the user is offline while they generate and reads the result later. Everything ships bilingual (zh / en).

Audience: 1-to-many AM team supporting ~20K long-tail sellers. The platform is leverage — it replaces hand-written trend reports with an automated research pipeline.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | `src/app` routes, route groups `(auth)` / `(main)` |
| UI | Tailwind + shadcn-style components, recharts | `components.json`, charts in dashboard |
| i18n | i18next / react-i18next | bilingual zh/en, `src/locales`, `src/lib/i18n.ts` |
| Data | Supabase (Postgres + Auth + Storage) | client/server/service-role split in `src/lib/supabase` |
| Background jobs | Inngest | all long-running pipelines run here, not in API routes |
| Email | Resend | report publish → email distribution |
| Validation | zod | schemas in `src/lib/validators` and per-pipeline `zod-schemas.ts` |
| Tests | vitest | `npm test` (run once), `__tests__` folders co-located |
| Deploy | Vercel | env vars: see `.kiro/steering/vercel-env-vars.md` |

## Commands

- `npm run dev` — local dev server (run manually; don't let an agent block on it)
- `npm run build` — production build
- `npm test` — vitest single run
- `npm run lint` — eslint
- `npm run backfill:translations` — backfill missing zh/en on existing rows
- `npm run backfill:topic-rankings` — recompute weekly topic rankings

## Architecture — three pipelines, one shared dictionary

The platform is three background pipelines that all classify topics through one shared canonical dictionary (`topic_canonicals`). Keeping classification unified across pipelines is a core invariant — see the `unify-topic-dictionary-across-pipelines` spec.

1. **Regular report** (scheduled or on-demand)
   `schedule-tick` / manual trigger → `research-engine` (two engines run + compared) → `synthesizer` → `reports` row (draft) → translate → **publish** → Resend email distribution.
   Code: `src/lib/research-engine/*`, `src/lib/inngest/functions/generate-report.ts`, `report-translate.ts`.

2. **Daily hot topic alert**
   `daily-alert-tick` → `scan` (web search) → `canonicalize` (map to `topic_canonicals`) → `novelty` (is this actually new?) → `persist` → `daily_hot_topic_alerts`.
   Code: `src/lib/daily-alert/*`, `src/lib/inngest/functions/daily-alert-*.ts`.

3. **Weekly topic rankings (trending)**
   No scheduler and no web scan. Rankings are persisted **synchronously inside report publish**: `PUT /api/reports/[id]/publish` → `runCanonicalizeBlock` → `persistWeeklyTopicRankings`. `topic-rankings/scan.ts` does not search the web — it transforms `report.content.modules[].topTopics` from the just-published report. Classification reuses the **daily** canonicalization prompt (`daily_canonicalization_prompt`), then writes the `topic_rankings` rows that drive the dashboard trend chart.
   Code: `src/lib/topic-rankings/*`, `src/app/api/reports/[id]/publish/route.ts`.
   **Silent-failure warning:** the canonicalize/persist block is wrapped so it never breaks the publish 200 response. If `OPENROUTER_API_KEY` is missing, the `daily_canonicalization_prompt` row is missing for the domain, or canonicalize fails, rankings are silently skipped (console log only). The dashboard trend chart also has a hard render gate — it needs ≥2 distinct `week_label` values, with no thin-history empty state — so an empty chart is ambiguous between "not enough history" and "publish-time persist silently failed". Check publish logs for `inserted=N`.

### Research engines (A/B)

`src/lib/research-engine/engines/` holds interchangeable engines (gemini, kimi/moonshot, openrouter, zai/GLM). Two engines run per report so output quality can be compared. Engine B has been swapped before (see `engine-b-glm-replacement` spec). Persona/prompt alignment across engines matters — see `prompt-recency-and-persona-alignment`.

## Data sources & contracts

Supabase tables (from `supabase/migrations`):

| Table | Holds |
|---|---|
| `profiles` | users + role (admin gate via `require-admin`) |
| `reports` | generated reports (draft → published), bilingual fields |
| `news` | curated news items, bilingual, pinnable |
| `notifications` | per-user unread/read |
| `domains` | source domains config |
| `prompt_templates` | versioned prompts for engines + daily scan |
| `schedule_configs` / `scheduled_runs` | regular report scheduling + run records |
| `daily_alert_configs` / `daily_alert_runs` | daily alert scheduling + run records |
| `daily_hot_topics` / `daily_hot_topic_alerts` | daily scan output |
| `topic_canonicals` | **shared** canonical topic dictionary (all pipelines classify into this) |

RLS policies in `003_*` and `016_*`. Admin-only mutations gated server-side (`daily-alert/require-admin.ts`). Migrations are sequential and append-only — never edit an applied migration, add a new one.

## API surface (`src/app/api`)

- `reports/` — list, `[id]`, `search`, `[id]/publish`
- `ai/` — `format-report`, `translate-report`, `translate-daily`
- `alerts/by-date/[date]`, `news/`, `notifications/`, `requests/`, `domains/`
- `inngest/` — Inngest webhook entrypoint
- `admin/*` — users, reports, news, prompt-templates, daily-alert configs/prompts/runs, scheduled-runs, schedule-config, translations/sweep, canonicals. Admin-gated.

## Core invariants (read `.kiro/steering/product-principles.md` for the full set)

- **Time doesn't matter — the user is offline.** Optimize background pipelines for completion + quality, not speed. Generous timeouts, retries over fail-fast. Don't advertise "3-minute reports".
- **Bilingual always.** Every user-facing string and AI-generated field must have zh + en. Translation sweeper backfills gaps.
- **One topic dictionary.** All three pipelines classify through `topic_canonicals`. Don't add a parallel classification path.
- **Idempotent runs.** Inngest functions must be safe to retry (`src/lib/inngest/idempotency.ts`).

## Agent rules

- Don't run destructive SQL or edit applied migrations — add a new migration file.
- Don't move long work into API routes — it belongs in an Inngest function.
- Lint + `npm test` before proposing a PR.
- Match existing steering (karpathy-guidelines, debugging-discipline, verification-before-completion, plan-before-coding) — they govern how to build here.

## Map of related context

- `.kiro/steering/` — how to build (engineering + product principles, response language, UI system)
- `.kiro/specs/` — per-feature requirements / design / tasks (10 specs, the closest thing to per-feature CONTEXT)
- `MEMORY.md` — why decisions were made (append-only decision log)
