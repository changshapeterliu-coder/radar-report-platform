# Design Document — Goal-Oriented Prompt Rewrite (v5)

## 1. Background and problem

After migration 013 landed on 2026-05-02, the first verification run exposed a
new quality regression: 6 of 10 Top topics rendered as "本周窗口期内未找到
卖家讨论证据" / "无本周数据" empty shells, despite Stage 1 reporting strong
signals (e.g. voice_volume 22, rank 1 "二审视频验证触发" with detailed
`initial_evidence`).

Investigation showed the problem is NOT that Stage 1 mis-ranked long-running
issues as hot topics. Stage 1's output contains specific本周 `initial_evidence`
and graceful decremented `voice_volume` (22→15→8→6→4 chains). Stage 1 works.

The root cause is **Stage 2 over-indexed on the time-layering rule I added in
migration 013** ("搜不到就留空，不要用旧料填"). The model interpreted this
as "even the narrative field should be empty if web_search didn't return new
verbatim quotes this week", ignoring the `initial_evidence` Stage 1 handed to
it.

Stepping back, this surfaced a broader issue: the prompts accumulated layers
of prescriptive if-else rules across multiple migrations (010 → 011 → 011b →
013). Each layer was added to fix one observed failure, but collectively they
now violate Anthropic's "context engineering" guidance on prompt altitude.

## 2. Framework applied — Anthropic "Effective context engineering for AI agents"

Reference: <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>

Key principles we're applying:

1. **"Right altitude"**: System prompts should "strike a balance: specific enough
   to guide behavior effectively, yet flexible enough to provide the model with
   strong heuristics". Avoid "hardcoded complex, brittle logic" (too low) and
   "vague, high-level guidance that falsely assumes shared context" (too high).

2. **"Minimal set of high-signal tokens"**: "Find the smallest possible set
   of high-signal tokens that maximize the likelihood of some desired
   outcome." Our current prompts repeat the 400-character time-layering
   block verbatim across 3 Stage prompts — net effect is noise, not signal.

3. **"Sub-agent architecture"**: "Sub-agents perform deep technical work...
   but returns only a condensed, distilled summary of its work." Stage 2 is a
   sub-agent to Stage 1 — its job is to *deepen* Stage 1's signal, not to
   *re-verify* topic existence.

4. **"Trust the model to act intelligently"**: "As model capabilities improve,
   agentic design will trend towards letting intelligent models act
   intelligently, with progressively less human curation."

## 3. Audit of current prompts (migration 013)

Eight distinct anti-patterns identified by reading the 4 prompts against the
framework:

| # | Issue | Criticality | Current behavior |
|---|---|---|---|
| 1 | Stage 2 sub-agent handoff broken | 🔴 | No instruction to trust Stage 1's signal; Stage 2 treats `initial_evidence` as raw reference, re-verifies topic itself, comes up empty. |
| 2 | Hardcoded "at least 2-3 searches" | 🔴 | Quantity-based brittle rule. Model has no way to know if 3 searches exhausted coverage or if 1 was enough. |
| 3 | Hardcoded "at least 3 topics" quota | 🔴 | Forces Stage 1 to pad Top-5 with weak signals when only 2-3 genuine hot topics exist. |
| 4 | "搜不到就留空不要用旧料填" over-broad | 🔴 | Intended for hard-evidence fields (quotes/cases); AI expanded to all fields including narrative. |
| 5 | 400-char time-layering block repeated 3x | 🟡 | Context rot — same tokens repeated across 3 prompts dilutes attention. |
| 6 | Three sections labeled "最高优先级" | 🟡 | Literal contradiction — model can't resolve "highest" among three. |
| 7 | "每个 topic 做 1 次 web_search" hardcoded | 🟡 | Stage 2 can't decide based on signal quality. |
| 8 | "相对优势/盲区" sections prescriptive | 🟢 | Lists specific media names as "优势", biases model to search only those sites. |
| 9 | `initial_evidence` schema doesn't require week-prefix | 🟢 | Stage 2 can't always tell which evidence is本周 vs historical. |

## 4. Design principles for v5 rewrite

1. **Role-driven, not rule-driven**: Define the role (身份 + 使命), let the
   role imply the behavior.
2. **Goal, not recipe**: "Collect sellers' weekly signals" — not "search 2-3
   times with 3 dimensions".
3. **Trust the agent**: Let Moonshot/GLM decide search depth, keywords, when
   to stop. They're agents with their own intelligence, not typewriters.
4. **Handoff-aware**: Stage 2 explicitly treats Stage 1's `initial_evidence`
   as verified context to build on, not raw data to re-verify.
5. **Minimal redundancy**: Cross-stage principles stated once per prompt,
   not copy-pasted verbatim. Each prompt earns its tokens.
6. **Honesty > coverage**: Allow Stage 1 to return 2 topics if only 2 exist.
   Allow Stage 2 to return short `quotes: []` if web_search came up empty —
   but *never* empty narrative.

## 5. Field-layering in Stage 2 (key innovation)

The central new idea. Fields are classified into three layers, each with
different rules on nullability:

### Layer A — Narrative fields (MUST have substantial content)
`narrative`, `painpoints`, `misconception.*`

Constructed from Stage 1 signal + background knowledge + any web_search
results. Even if web_search fails entirely, Stage 1 signal alone is
sufficient to write meaningful narrative. **Forbidden** to be empty or to
contain the phrase "本周无数据" / "未找到本周讨论".

### Layer B — Evidence fields (MAY be empty if web_search found nothing)
`quotes[]`, `cases[]`, `quantified_observations[]`

These need本周 hard evidence. If web_search doesn't return it → `[]`.
Never fabricate.

### Layer C — Meta fields
`confidence` (honest signal strength), `sources_channels`, `module`, `topic`.

This layering resolves the tension that broke the 2026-05-02 run. It tells
the model exactly where the "leave empty, don't fabricate" rule applies
(Layer B) and where it doesn't (Layer A).

## 6. File-level diff map

| File | Change type | Details |
|---|---|---|
| `supabase/migrations/014_goal_oriented_prompt_rewrite.sql` | CREATE | Rewrites 4 DB prompts in goal-oriented style per §4 principles. Idempotent UPDATEs. |
| `.kiro/specs/goal-oriented-prompt-rewrite/*` | CREATE | This spec artifact. |

No code changes. No schema changes. No type changes. Stage 3 / Stage 4
system prompts in `src/lib/research-engine/system-prompts.ts` NOT touched
(out of scope; those prompts have different failure modes and should be
evaluated in a separate follow-up).

## 7. Rollback plan

Single-tier: re-run migration 013 (idempotent UPDATE). Prompts revert in
one SQL execution. Code path unaffected.

## 8. Verification plan

### Gate 1: Preview migration contents

Before execution, verify 4 `UPDATE` statements target correct `prompt_type`
rows and the new template texts contain:
- Persona lines matching Moonshot K2-0906 / GLM-4.6 (unchanged from 013)
- No "必须调用 X 次" quantity rules
- No "必须至少 3 条" topic quota
- Stage 2 contains "信任 Stage 1" handoff clause + A/B/C layer field section

### Gate 2: Post-migration SQL verification

```sql
SELECT prompt_type,
       LENGTH(template_text) AS text_len,
       template_text NOT LIKE '%至少 2-3 次%' AS rule_2_removed,
       template_text NOT LIKE '%必须至少 3 条%' AS rule_3_removed,
       template_text LIKE '%信任 Stage 1%' AS stage2_handoff_present,
       updated_at
FROM prompt_templates
WHERE prompt_type IN ('engine_a_hot_radar', 'engine_b_hot_radar',
                      'shared_deep_dive', 'synthesizer_prompt')
ORDER BY prompt_type;
```

Expected: `rule_2_removed = true` and `rule_3_removed = true` for Stage 1
rows; `stage2_handoff_present = true` for `shared_deep_dive` row.

### Gate 3: Behavioral verification — trigger 2 runs

Per Anthropic's "evidence over claims": one run is a single sample that
might be LLM noise. Run twice to observe stability. For each run:

1. Open `/reports/[id]`
2. Count Module 1 + 2 topics where `narrative` is non-empty and >100 chars
3. Count topics where `narrative` contains the forbidden phrase "本周
   窗口期内未找到" or "无本周数据"
4. Check 2-3 sample `QUOTE` blocks: are sources from within the coverage
   window?

Expected on each run:
- ≥8 of 10 Module 1+2 topics have non-empty narrative (vs. 4 of 10 on
  2026-05-02 pre-rewrite)
- 0 topics have forbidden phrases in narrative
- Quotes that exist are within the coverage window

If run 1 fails but run 2 passes → acceptable (LLM variance).
If both fail → rollback migration 013.

## 9. Known risks

| Risk | Mitigation |
|---|---|
| Removing "必须至少 3 条" may cause Stage 1 to return 0 topics for a quiet week | Prompt still includes "基线现实" clause explaining that a fully empty week is near-impossible; removing the hard quota only lets honesty win over padding. |
| Removing "至少 2-3 次搜索" may cause lazy-path regression (7-second empty returns) | Prompt still says "如果首次搜索信号稀薄，请主动调整关键词再搜"; this is goal-oriented signal-quality guidance, not quantity quota. Moonshot/GLM both have agentic loops; trust them. |
| Trusting Stage 1 handoff may propagate Stage 1 errors downstream | Existing `confidence` field already captures this — Stage 2 marks "Low Confidence · 基于 Stage 1 信号展开" when web_search didn't enrich. |
| One-shot rewrite (3 prompts in 1 migration) makes root-causing failure hard | Verification requires 2 runs; if both fail, whole migration rolls back to 013 via re-running 013 SQL. No partial state. |

## 10. Non-goals (explicit)

- Not touching Stage 3 (education-mapper) / Stage 4 (assembler) code-level
  prompts (different failure mode, different spec).
- Not introducing Engine A/B weighting in synthesizer.
- Not changing the 4-module output structure, schema, or voice_volume
  formula.
- Not removing the data source lists (雨果网、亿恩网 etc.) — those are
  legitimate source guides, not event examples.
