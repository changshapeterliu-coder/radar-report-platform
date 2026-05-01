# Product Principles — Radar Report Platform

Long-term product decisions that apply to every feature on this platform.
Unlike engineering guidelines (karpathy / verification / debugging / etc.)
which govern *how* to build, these govern *what* the platform is.

**Status**: Always included. Re-read before designing any new feature,
prompt, schema, or integration.

---

## Principle 1: Time doesn't matter — user is offline

### What it means

Report generation is **asynchronous and backgrounded**. The user triggers
(or schedules) a run, then walks away. They see the result when they come
back minutes or hours later. They are never waiting in front of a spinner.

**Therefore**: optimize for **completion & quality**, not for **speed**.

### Concrete rules

- **Prefer generous timeouts** over aggressive fail-fast
  - Stage 1/2 (web search): 240s+, not 50s or 120s
  - Never time out faster than the slowest observed legitimate response
  - Reserve aggressive timeouts for interactive endpoints (API routes the
    user is actually waiting on, like `/api/reports/[id]`)

- **Prefer retries** over failing a whole run
  - Transient network errors → 2-3 retries with backoff
  - Rate-limited → wait and retry
  - Only fail when the error is clearly permanent (401, malformed final output)

- **Prefer more AI calls** over cutting corners to save seconds
  - Two-step API call (search → structure) beats one unreliable call
  - A 90s deep-dive producing real evidence beats a 30s shallow summary
  - Parallel calls are fine (already doing this); serial with more steps
    is fine too if each step is reliable

- **Don't advertise "3 minute reports"** as a product feature
  - Users will scrutinize the time and get anxious when a run takes 8min
  - Instead advertise: "reliable, deep, cited reports — scheduled or on demand"

### What it does NOT mean

- Don't *waste* time for no reason — if something genuinely takes 30s don't 
  set the timeout to 600s.
- Don't make interactive UIs slow. This principle is about **background 
  pipelines** (Inngest functions, cron jobs), not about page-load latency.
- Don't let Vercel/Inngest auto-kill you. Stay within platform limits 
  (Pro = 300s per step).

### Precedent in the codebase

- `src/lib/research-engine/engines/gemini.ts` / `kimi.ts`:  
  Stage 1/2 timeouts at 240s, Stage 3/4 at 60-90s.  
  First set at 50s, found insufficient; raised to 120s, still 33% failure rate;
  raised to 240s — the right number for cross-border search with 2-3 tool_calls
  rounds.

---

## Principle 2: Prompt engineering is the last resort, not the first

### What it means

Prompts are requests for the AI to behave. They're probabilistic — the AI
will comply "most of the time" but can and does violate them. Whenever a
reliability, structure, or correctness property can be enforced **outside
the prompt**, do that instead.

**Therefore**: when something goes wrong, the first question is 
"**can this be fixed with schema / architecture / API constraints?**"
Only if the answer is no do we touch the prompt.

### Concrete rules (in order of preference)

1. **API-level constraints first**:
   - `response_format: json_schema` with a real Zod schema → constrained 
     decoding guarantees valid JSON at the token level
   - `response_format: json_object` (lighter constraint)
   - Structured output features from the provider (OpenAI, Anthropic, 
     Qwen, Moonshot all have some form)

2. **Architecture-level solutions next**:
   - Split a brittle single-call into multi-step pipeline where each step 
     has a narrow goal (like our Qwen search → structure two-step)
   - Run validation (Zod) *after* the AI call; on failure, send AI the 
     validation errors and ask for a correction (feedback loop)
   - Route untrusted AI output through a *deterministic* normalizer in 
     code before hitting downstream code (e.g. `normalizeHotRadarTopic`)
   - Use code-level defenses: `stripCodeFences`, `JSON.parse` with try/catch, 
     `?? []` fallbacks, etc.

3. **Only then** touch the prompt:
   - Clarify ambiguous instructions (e.g. "severity must be one of high | 
     medium | low, never 'critical'")
   - Add concrete examples of desired output
   - Explicitly forbid common failure modes (e.g. "do NOT wrap output in 
     markdown fences")

4. **Avoid at all costs**:
   - Multi-paragraph "⚠️ critical rules" blocks in a prompt expecting the AI 
     to obey them deterministically — this is hope, not engineering
   - Increasingly desperate all-caps warnings
   - "If you violate this the system will crash" threats

### Why

Every prompt rule is a liability: it can be ignored, misread, or obeyed in
an unexpected way. Every API-layer constraint is enforceable in code.

### Precedent in the codebase

- **Qwen `$web_search` + `response_format` conflict**: First tried to drop
  `response_format` and lean on prompt ("return only JSON"). Realized this
  was prompt-hope. Refactored `callQwen` into two-step flow 
  (`search` → `structure`) where Step 2 gets `response_format: json_object` 
  (API constraint) — 100% reliable structured output.
- **v4 Markdown-hybrid schema**: TopTopics is Zod-validated, markdown is free 
  text. Strict fields where we need queryability; loose field where we just 
  need human-readable output. Neither relies on prompt behavior to enforce 
  the split — the **data model itself** encodes the guarantee.

---

## Principle 3: Bilingual content is a first-class concern, from day one

### What it means

Every user-visible text — report content, news, UI labels, notifications, 
error messages, email bodies — must have a path to both Chinese and English 
output. "Translate later" is never acceptable as a design decision, because 
"later" always requires re-architecting the data model.

**Therefore**: every feature's schema, API, and UI must have bilingual 
capability built in from the first commit, even if only one language is 
populated initially.

### Concrete rules

- **DB schema design**:
  - Text content that's user-visible → always has a `content_translated` / 
    `_en` / `_zh` companion field (even if left null initially)
  - Don't store raw text and "figure out later" — figure out now

- **API endpoints**:
  - Reading content → respect `?lang=` query param or user preference; 
    return the right language version
  - Writing content → store in original language + optionally pre-populate 
    translated version via the translate-report endpoint
  - New endpoint for user-visible text without bilingual path → reject at 
    design review

- **UI**:
  - All static strings → `t('key')` via react-i18next
  - Dynamic content (from DB) → render the correct language based on 
    `i18n.language` and available translations

- **AI pipeline**:
  - AI can produce Chinese OR English (whichever the prompt requests) — 
    the translation layer lives *after* generation, not inside generation
  - Synthesizer → reports.content (original) → translate-report endpoint 
    → reports.content_translated
  - This keeps generation prompts simple (one language) and separates 
    translation as its own concern

- **New features**:
  - Every new feature PR must answer: "How does an English-only user see 
    this feature?" Answer must be concrete.

### What it does NOT mean

- Every commit needs to populate both languages immediately. We can ship 
  Chinese-first and backfill English through the translate endpoint.
- UI needs to be localized into N languages from day 1. **Two languages** 
  is the target: Chinese + English. Not a general i18n framework for 50 
  languages.

### Precedent in the codebase

- `reports.content` (zh) + `reports.content_translated` (en) — bilingual 
  by design since v1
- `news.title` + `news.content_translated` — same pattern
- `src/components/I18nProvider.tsx` + `t()` everywhere in UI
- `/api/ai/translate-report` — standalone translate path

### Red flag — when to push back

If a new feature PR comes in without a bilingual story, the answer is: 
"**stop, design the bilingual story first**". This is a principle-level 
concern, not an implementation detail.

---

## How these three principles interact

Often reinforcing:

- **Principle 1 enables Principle 2**: if we have time budget, we can
  afford the extra API call (structure step) instead of a shaky one-call 
  prompt hack.
- **Principle 2 enables Principle 3**: when translation is architectural 
  (separate endpoint) instead of prompt-level (tell the AI "also translate"), 
  it's reliable.
- **Principle 3 benefits from Principle 1**: translation adds time; we're 
  OK with it.

When they conflict, order of precedence:
1. **Principle 2** (no prompt hacks) wins always. Never apologize for 
   using more API calls / more schema rigor to avoid prompt fragility.
2. **Principle 3** (bilingual) wins over **Principle 1** (time). If 
   bilingual takes 30 more seconds, that's fine — users aren't waiting.
3. **Principle 1** (time doesn't matter) is the most flexible — it says 
   "we *can* spend more time", not "we *must*".
