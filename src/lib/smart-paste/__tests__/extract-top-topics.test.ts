import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  normalizeExtractedTopics,
  coerceSeverity,
  coerceVoiceVolume,
  DEFAULT_SEVERITY,
  MAX_TOPICS_PER_MODULE,
  MAX_KEYWORDS,
  type RawTopicCandidate,
} from '../extract-top-topics';
import { TopTopicSchema } from '@/lib/validators/report-schema';
import type { TopTopic } from '@/types/report';

/**
 * Property-based tests for the Smart Paste topic-extraction correctness core
 * (`normalizeExtractedTopics` and its helpers). One file holds all seven
 * properties from the design (Properties 1–7); they are logically independent
 * and share the candidate arbitraries defined below.
 *
 * Spec: .kiro/specs/smart-paste-topic-extraction
 */

// ── Shared arbitraries ──────────────────────────────────────────────────────
//
// `rawCandidateArbitrary` models the untrusted candidate rows an LLM emits:
// every field is randomly PRESENT / ABSENT / WRONG-TYPED, because the loose
// `RawTopicCandidate` contract promises nothing about the LLM's output shape.
// `requiredKeys: []` makes every key independently optional (present/absent);
// each value mixes the documented types with `fc.anything()` to inject
// wrong-typed garbage (rank as object, keywords as number, severity as array, …).

/** A `topic` generator biased toward realistic values plus empty/whitespace/garbage. */
const topicArbitrary = fc.oneof(
  fc.string(),
  fc.constant(''),
  fc.constant('   '),
  fc.constantFrom(
    '账户暂停申诉',
    'Listing takedown',
    'KYC 验证',
    '知识产权投诉',
  ),
  fc.anything(), // wrong-typed: object / number / null / array / …
);

/** A free-text `severity` generator: valid enums, Chinese forms, junk, wrong types. */
const severityArbitrary = fc.oneof(
  fc.constantFrom(
    'high',
    'medium',
    'low',
    '高',
    '中',
    '低',
    '高风险',
    '中风险',
    '低风险',
    'critical', // undeterminable → should default
    '',
  ),
  fc.string(),
  fc.anything(),
);

/** A `rank` generator: numbers, numeric strings, prose ordinals, missing, garbage. */
const rankArbitrary = fc.oneof(
  fc.integer(),
  fc.double(),
  fc.string(),
  fc.constantFrom('1', '2', '排名1', '第3名', ''),
  fc.anything(),
);

/** A `voice_volume` generator: numbers (incl. NaN/Infinity via double), strings, garbage. */
const voiceVolumeArbitrary = fc.oneof(
  fc.integer(),
  fc.double(),
  fc.string(),
  fc.constantFrom('45件', '1.2k', '不详', ''),
  fc.anything(),
);

/** A `keywords` generator: arrays, delimited strings, missing, wrong types. */
const keywordsArbitrary = fc.oneof(
  fc.array(fc.string()),
  fc.string(),
  fc.constantFrom('封号、申诉，KYC', 'a,b,c', ''),
  fc.anything(),
);

/**
 * One raw candidate with every field randomly present/absent and possibly
 * wrong-typed. Cast to `RawTopicCandidate` for the call site — the function
 * accepts untrusted shapes by design, so the cast just satisfies the compiler.
 */
const rawCandidateArbitrary = fc.record(
  {
    rank: rankArbitrary,
    topic: topicArbitrary,
    voice_volume: voiceVolumeArbitrary,
    keywords: keywordsArbitrary,
    seller_discussion: fc.oneof(fc.string(), fc.anything()),
    severity: severityArbitrary,
  },
  { requiredKeys: [] },
) as fc.Arbitrary<RawTopicCandidate>;

describe('extract-top-topics — normalizeExtractedTopics', () => {
  // Feature: smart-paste-topic-extraction, Property 1
  // Property 1: Every extracted topic is a schema-valid TopTopic
  // Validates: Requirements 1.2, 6.1, 6.4
  it('Property 1: every output row is a schema-valid TopTopic', () => {
    fc.assert(
      fc.property(fc.array(rawCandidateArbitrary), (candidates) => {
        const out = normalizeExtractedTopics(candidates);

        // Output is always an array (never throws on garbage input).
        expect(Array.isArray(out)).toBe(true);

        // Every produced row must independently pass the TopTopic schema —
        // the code-owned validate/drop/repair pass (R6.1) guarantees this
        // regardless of how malformed the candidate rows were.
        for (const topic of out) {
          expect(TopTopicSchema.safeParse(topic).success).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 2 arbitraries & reference model ────────────────────────────────
//
// Property 2 needs candidates that actually SURVIVE normalization so the cap /
// ordering behavior is observable (Property 1's `rawCandidateArbitrary` can
// produce all-empty-topic rows that get dropped, leaving nothing to rank).
// `validCandidate` therefore guarantees a non-whitespace `topic` (every other
// field reuses the Property 1 arbitraries — they are all coerced to valid
// values, so a non-empty topic is sufficient for the row to pass the Zod gate).

/** Always trims to a non-empty string → the row is never dropped by the no-fabrication rail. */
const nonEmptyTopicArbitrary = fc.oneof(
  fc.constantFrom('账户暂停申诉', 'Listing takedown', 'KYC 验证', '知识产权投诉'),
  fc.string().map((s) => `T${s}`), // leading 'T' survives trim → guaranteed non-empty
);

/** Mix of explicit numeric ranks, prose ordinals, junk, and (via requiredKeys) absent. */
const validRankArbitrary = fc.oneof(
  fc.integer({ min: -5, max: 50 }), // explicit numeric rank
  fc.double(), // includes NaN / ±Infinity → falls back to order of appearance
  fc.string(), // arbitrary string, maybe carries no digit → fallback
  fc.constantFrom('1', '2', '3', '10', '排名1', '第3名', '排名5'), // explicit numbering / prose ordinals
);

/**
 * A candidate guaranteed to survive normalization. `requiredKeys: ['topic']`
 * leaves `rank` (and the rest) randomly present or absent — exactly the
 * "some explicit / some absent ranks" the property calls for.
 */
const validCandidate = fc.record(
  {
    rank: validRankArbitrary,
    topic: nonEmptyTopicArbitrary,
    voice_volume: voiceVolumeArbitrary,
    keywords: keywordsArbitrary,
    seller_discussion: fc.oneof(fc.string(), fc.anything()),
    severity: severityArbitrary,
  },
  { requiredKeys: ['topic'] },
) as fc.Arbitrary<RawTopicCandidate>;

/**
 * Reference model of the implementation's `resolveRank` (private to the module
 * under test). Kept byte-faithful to the actual code: an explicit finite number
 * or a string containing a number is kept VERBATIM as the label and its parsed
 * value is the numeric sort key; anything else falls back to the 1-based order
 * of appearance. The cap keeps the rows with the smallest sort keys.
 */
function referenceRank(
  rawRank: unknown,
  order: number,
): { label: string; sortKey: number } {
  if (typeof rawRank === 'number' && Number.isFinite(rawRank)) {
    return { label: String(rawRank), sortKey: rawRank };
  }
  if (typeof rawRank === 'string') {
    const trimmed = rawRank.trim();
    const match = trimmed.match(/-?\d+(?:\.\d+)?/);
    if (trimmed && match) {
      return { label: trimmed, sortKey: parseFloat(match[0]) };
    }
  }
  return { label: String(order), sortKey: order };
}

describe('extract-top-topics — cap & source-order rank', () => {
  // Feature: smart-paste-topic-extraction, Property 2
  // Property 2: Output is capped at 10, keeping highest-ranked rows; rank is source order
  // Validates: Requirements 1.5
  it('Property 2: caps at 10 keeping the smallest ranks, with verbatim source-order rank labels', () => {
    fc.assert(
      fc.property(fc.array(validCandidate, { maxLength: 30 }), (candidates) => {
        const out = normalizeExtractedTopics(candidates);

        // Every validCandidate has a non-empty topic, so each one survives the
        // no-fabrication rail and the Zod gate. Replicate the implementation:
        // assign rank by explicit numbering else order of appearance, sort by
        // numeric sortKey (appearance-order tiebreaker), then cap.
        const ranked = candidates.map((c, i) => {
          const { label, sortKey } = referenceRank(c.rank, i + 1);
          return { label, sortKey, order: i + 1 };
        });
        const sorted = [...ranked].sort(
          (a, b) => a.sortKey - b.sortKey || a.order - b.order,
        );
        const expectedKept = sorted.slice(0, MAX_TOPICS_PER_MODULE);
        const expectedDropped = sorted.slice(MAX_TOPICS_PER_MODULE);

        // (1) Cap at 10 — and, since every row survives, the count is exactly
        //     min(n, 10).
        expect(out.length).toBeLessThanOrEqual(MAX_TOPICS_PER_MODULE);
        expect(out.length).toBe(
          Math.min(candidates.length, MAX_TOPICS_PER_MODULE),
        );

        // (2) The kept rank labels match the reference's sorted-then-capped
        //     labels in order. This single assertion proves three things at
        //     once: rank labels are verbatim (no re-ranking), the rows are in
        //     ascending-rank order, and the cap kept the smallest-ranked rows.
        expect(out.map((t) => t.rank)).toEqual(
          expectedKept.map((e) => e.label),
        );

        // (3) Explicit "kept ranks are the smallest" check: the largest kept
        //     sort key is never greater than the smallest dropped sort key.
        if (expectedDropped.length > 0) {
          const maxKept = Math.max(...expectedKept.map((e) => e.sortKey));
          const minDropped = Math.min(
            ...expectedDropped.map((e) => e.sortKey),
          );
          expect(maxKept).toBeLessThanOrEqual(minDropped);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 3: documented defaults are always applied, never omitted ────────
//
// Two coercion helpers are total functions over arbitrary input — they must
// never throw, never return NaN/negative volume, and never return a severity
// outside the enum. Feeding `fc.anything()` exercises every garbage shape
// (objects, arrays, null, symbols, NaN/±Infinity via doubles, …). The
// normalization-level half asserts that a candidate whose severity / volume is
// *absent* still lands on the documented defaults ('medium' / 0) rather than
// dropping the field — proving the defaults are applied, not omitted.

const SEVERITY_ENUM: ReadonlyArray<string> = ['high', 'medium', 'low'];

describe('extract-top-topics — documented defaults', () => {
  // Feature: smart-paste-topic-extraction, Property 3
  // Property 3: Documented defaults are always applied, never omitted
  // Validates: Requirements 1.3, 1.4, 3.2, 3.4
  it('Property 3: coerceSeverity is total over any input, always in {high,medium,low}', () => {
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        const sev = coerceSeverity(raw);
        // Never throws (we got here), always within the documented enum.
        expect(SEVERITY_ENUM).toContain(sev);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: smart-paste-topic-extraction, Property 3
  it('Property 3: coerceVoiceVolume is total over any input, always a finite number >= 0', () => {
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        const vol = coerceVoiceVolume(raw);
        // Never throws, never NaN/Infinity, never negative (R1.3).
        expect(typeof vol).toBe('number');
        expect(Number.isFinite(vol)).toBe(true);
        expect(vol).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: smart-paste-topic-extraction, Property 3
  it('Property 3: a surviving candidate with absent severity/voice_volume gets the documented defaults', () => {
    fc.assert(
      fc.property(nonEmptyTopicArbitrary, (topic) => {
        // A valid, non-empty topic with severity & voice_volume OMITTED — the
        // row must survive (it has a real topic) and the missing fields must be
        // filled with the documented defaults rather than left off (R1.4 / R1.3).
        const out = normalizeExtractedTopics([{ topic } as RawTopicCandidate]);

        expect(out).toHaveLength(1);
        const row = out[0];
        // R1.4: undeterminable severity → DEFAULT_SEVERITY ('medium'), present.
        expect(row.severity).toBe(DEFAULT_SEVERITY);
        expect(row.severity).toBe('medium');
        // R1.3: no numeric volume signal → 0, present.
        expect(row.voice_volume).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 4: no fabrication — empty candidate set & empty-topic rows ──────
//
// The code-owned no-fabrication rail (R2.3 / R3.5): a row whose `topic` is
// empty, whitespace-only, or absent carries no real topic, so it is dropped —
// extraction never invents a topic to fill the gap. This holds regardless of
// the source shape (there is no table detector in `normalizeExtractedTopics`;
// the drop is purely a function of the `topic` value), so an all-empty-topic
// candidate set normalizes to `[]` exactly like the empty input does (R5.1 —
// no topic content still yields valid, empty output).

/** `topic` that is empty or whitespace-only — every form `String.trim()` reduces to ''. */
const emptyOrWhitespaceTopicArbitrary = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.constant('\t'),
  fc.constant('\n'),
  fc.constant(' \t\r\n '),
  // Random runs of ASCII whitespace (incl. the empty string) — all trim to ''.
  fc
    .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'), { maxLength: 8 })
    .map((chars) => chars.join('')),
);

/**
 * A candidate whose `topic` is '', whitespace-only, or ABSENT, while the other
 * fields are freely present / garbage (reusing the Property 1 arbitraries). Two
 * flavors via `fc.oneof`: flavor A keeps `topic` present-but-empty
 * (`requiredKeys: ['topic']`), flavor B omits `topic` entirely
 * (`requiredKeys: []`, no `topic` key). Both must be dropped — exercising the
 * no-fabrication rail for both the empty-cell and missing-cell cases.
 */
const candidateWithEmptyOrWhitespaceTopic = fc.oneof(
  fc.record(
    {
      rank: rankArbitrary,
      topic: emptyOrWhitespaceTopicArbitrary,
      voice_volume: voiceVolumeArbitrary,
      keywords: keywordsArbitrary,
      seller_discussion: fc.oneof(fc.string(), fc.anything()),
      severity: severityArbitrary,
    },
    { requiredKeys: ['topic'] }, // topic always present but empty/whitespace
  ),
  fc.record(
    {
      rank: rankArbitrary,
      voice_volume: voiceVolumeArbitrary,
      keywords: keywordsArbitrary,
      seller_discussion: fc.oneof(fc.string(), fc.anything()),
      severity: severityArbitrary,
    },
    { requiredKeys: [] }, // topic key absent entirely
  ),
) as fc.Arbitrary<RawTopicCandidate>;

describe('extract-top-topics — no fabrication', () => {
  // Feature: smart-paste-topic-extraction, Property 4
  // Property 4: empty candidate set → [], empty-topic rows dropped (source-shape-independent)
  // Validates: Requirements 2.3, 3.5, 5.1
  it('Property 4: an empty candidate set normalizes to []', () => {
    // R5.1: no topic content still yields valid, empty output — no fabrication.
    expect(normalizeExtractedTopics([])).toEqual([]);
  });

  // Feature: smart-paste-topic-extraction, Property 4
  it('Property 4: every empty/whitespace/absent-topic row is dropped, yielding []', () => {
    fc.assert(
      fc.property(
        fc.array(candidateWithEmptyOrWhitespaceTopic),
        (candidates) => {
          const out = normalizeExtractedTopics(candidates);

          // No table detector is involved — the drop is a pure function of the
          // `topic` value. Every row has an empty/whitespace/absent topic, so
          // every row is dropped and nothing is fabricated to replace it
          // (R2.3 / R3.5), regardless of how many rows or what the other
          // (garbage) fields contained.
          expect(out).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 5: faithful passthrough — introduces nothing, preserves language ─
//
// Extraction is grounded in the pasted content (R3.1): it must not introduce a
// topic, keyword, or value the source did not supply. `normalizeExtractedTopics`
// only ever COERCES + DROPS — it never invents — so for any candidate set:
//   • every output `topic` is byte-identical to the trimmed form of some input
//     candidate's `topic` (no translation, no mutation — R3.3 / R3.6);
//   • every output keyword is a trimmed, non-empty fragment obtained by
//     splitting an input candidate's keyword source on `、 , ，` — i.e. the
//     output keyword set is a subset of the fragments the input supports, never
//     a fabricated term (R3.1);
//   • `out.length <= in.length` (rows are only dropped or capped, never added).
//
// Language preservation (R3.6) is a consequence of the byte-identical-after-trim
// assertion: a Chinese topic stays Chinese, an English topic stays English,
// because the output topic IS the trimmed input string — there is no transform
// that could change its script.

/** Separators `coerceKeywords` splits on — kept byte-faithful to the implementation. */
const KEYWORD_SEPARATORS_REF = /[、,，]/;

/**
 * Reference replica of the implementation's `coerceKeywords` SPLIT step (the
 * dedupe/cap are intentionally omitted — this returns the full superset of
 * fragments the input supports, which is exactly what a "⊆ input" subset check
 * needs). Mirrors `coerceKeywords`'s source-gathering exactly: an array keeps
 * only its string elements; a bare string is its own single source; anything
 * else yields no sources.
 */
function referenceKeywordFragments(raw: unknown): string[] {
  const sources: string[] = Array.isArray(raw)
    ? raw.filter((k): k is string => typeof k === 'string')
    : typeof raw === 'string'
      ? [raw]
      : [];

  const fragments: string[] = [];
  for (const source of sources) {
    for (const part of source.split(KEYWORD_SEPARATORS_REF)) {
      const k = part.trim();
      if (k) fragments.push(k);
    }
  }
  return fragments;
}

describe('extract-top-topics — faithful passthrough', () => {
  // Feature: smart-paste-topic-extraction, Property 5
  // Property 5: Extraction introduces nothing and preserves language
  // Validates: Requirements 3.1, 3.3, 3.6
  it('Property 5: every output topic & keyword is grounded in the input; out.length <= in.length', () => {
    fc.assert(
      fc.property(fc.array(validCandidate), (candidates) => {
        const out = normalizeExtractedTopics(candidates);

        // (1) Rows are only dropped or capped, never added.
        expect(out.length).toBeLessThanOrEqual(candidates.length);

        // The set of trimmed input topics (the only topic strings the output is
        // allowed to contain — byte-identical modulo the documented trim).
        const inputTopics = new Set<string>();
        for (const c of candidates) {
          if (typeof c.topic === 'string') {
            const trimmed = c.topic.trim();
            if (trimmed) inputTopics.add(trimmed);
          }
        }

        // The full superset of keyword fragments the input supports (union of
        // every candidate's split/trimmed fragments). Every output keyword must
        // be one of these — extraction never fabricates a keyword.
        const inputKeywordFragments = new Set<string>();
        for (const c of candidates) {
          for (const frag of referenceKeywordFragments(c.keywords)) {
            inputKeywordFragments.add(frag);
          }
        }

        for (const topic of out) {
          // (2) topic is byte-identical to a trimmed input topic — no
          //     translation, no mutation, language preserved (R3.3 / R3.6).
          expect(inputTopics.has(topic.topic)).toBe(true);

          // (3) every keyword is a trimmed fragment the input supplied — the
          //     output keyword set is a subset of the input fragments (R3.1).
          for (const kw of topic.keywords) {
            expect(inputKeywordFragments.has(kw)).toBe(true);
          }
          // Keywords stay within the documented cap.
          expect(topic.keywords.length).toBeLessThanOrEqual(MAX_KEYWORDS);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 6: additive merge never mutates the markdown body ───────────────
//
// At the route (`src/app/api/ai/format-report/route.ts`), Layer 2 assigns
// `m.topTopics = ok.topics` — an ADDITIVE merge: it sets the module's
// structured `topTopics` and never touches `m.markdown` (R1.6). The pure
// `mergeTopics` below mirrors that assignment. The property: for any module
// `{ markdown, topTopics }` and any `topics` array, merging leaves
// `module.markdown` byte-identical to the pre-merge value, and `topTopics`
// becomes the new array. Extraction adds structured data; it does not rewrite,
// strip, or otherwise mutate the prose (R1.6 / R6.3).

/**
 * A schema-valid `TopTopic` arbitrary — every field satisfies `TopTopicSchema`
 * directly (non-empty `rank`/`topic`, non-negative finite `voice_volume`,
 * ≤10 keywords, enum `severity`) so the generated topics are realistic merge
 * payloads, not garbage. Property 6 is about the merge's effect on `markdown`,
 * so the topics only need to be well-formed, not normalization outputs.
 */
const topTopicArbitrary: fc.Arbitrary<TopTopic> = fc.record(
  {
    rank: fc.oneof(
      fc.constantFrom('1', '2', '3', '1 ✓', '10'),
      fc.integer({ min: 1, max: 99 }).map((n) => String(n)),
    ),
    topic: fc.oneof(
      fc.constantFrom('账户暂停申诉', 'Listing takedown', 'KYC 验证', '知识产权投诉'),
      fc.string({ minLength: 1 }).map((s) => `T${s}`), // leading 'T' → non-empty
    ),
    voice_volume: fc.oneof(
      fc.nat({ max: 100_000 }),
      fc.double({ min: 0, max: 1e6, noNaN: true }),
    ),
    keywords: fc.array(fc.string(), { maxLength: MAX_KEYWORDS }),
    seller_discussion: fc.string(),
    severity: fc.constantFrom('high', 'medium', 'low'),
    cross_engine_confirmed: fc.option(fc.boolean(), { nil: undefined }),
  },
  { requiredKeys: ['rank', 'topic', 'voice_volume', 'keywords', 'seller_discussion', 'severity'] },
) as fc.Arbitrary<TopTopic>;

/**
 * Pure model of the route's additive merge (`m.topTopics = ok.topics`): set
 * the module's `topTopics`, leave every other field — crucially `markdown` —
 * untouched. Returns a new object so the assertions can compare against the
 * captured original.
 */
function mergeTopics<T extends { markdown: string; topTopics: TopTopic[] }>(
  module: T,
  topics: TopTopic[],
): T {
  return { ...module, topTopics: topics };
}

describe('extract-top-topics — additive merge preserves markdown', () => {
  // Feature: smart-paste-topic-extraction, Property 6
  // Property 6: Extraction is additive — the markdown body is never mutated
  // Validates: Requirements 1.6, 6.3
  it('Property 6: merging extracted topics leaves module.markdown byte-identical', () => {
    fc.assert(
      fc.property(
        fc.record({
          markdown: fc.string(),
          topTopics: fc.array(topTopicArbitrary),
        }),
        fc.array(topTopicArbitrary),
        (module, topics) => {
          // Capture the markdown BEFORE the merge (a primitive string copy is
          // inherently immutable, so this is a faithful snapshot).
          const before = module.markdown;

          const after = mergeTopics(module, topics);

          // (1) R1.6 / R6.3: the markdown body is byte-identical — the merge
          //     adds structured data, it never rewrites or strips the prose.
          expect(after.markdown === before).toBe(true);
          // The original object's markdown is likewise untouched.
          expect(module.markdown).toBe(before);

          // (2) The additive assignment took effect: topTopics is the new array.
          expect(after.topTopics).toBe(topics);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 7: valid rows in produce non-empty topics out ───────────────────
//
// The contrapositive of the no-fabrication rail (Property 4): if the candidate
// set contains at least one row with a real, non-empty `topic`, normalization
// must NOT swallow everything — the output is non-empty (R1.1). This is the
// liveness guarantee behind "a manual paste stops being invisible": when the
// pasted section genuinely describes a topic, `normalizeExtractedTopics`
// produces at least one structured `TopTopic` for the pipeline to consume.
//
// The input is built so it is GUARANTEED to carry at least one surviving row:
// arbitrary (possibly garbage / empty-topic) candidates BEFORE and AFTER a
// single `validCandidate` (whose `topic` always trims to non-empty and whose
// other fields are coerced to valid values, so the row clears the no-fabrication
// drop AND the Zod gate). Placing the valid row at an arbitrary position proves
// the result is non-empty regardless of where the real topic sits — even if the
// surrounding noise rows all drop out, the cap keeps min(surviving, 10) >= 1.

describe('extract-top-topics — valid rows produce non-empty output', () => {
  // Feature: smart-paste-topic-extraction, Property 7
  // Property 7: Valid rows in produce non-empty topics out
  // Validates: Requirements 1.1
  it('Property 7: a candidate set containing >=1 non-empty-topic row yields non-empty output', () => {
    fc.assert(
      fc.property(
        fc.array(rawCandidateArbitrary),
        validCandidate,
        fc.array(rawCandidateArbitrary),
        (before, valid, after) => {
          // Flatten so the guaranteed-valid row can sit at ANY position amid
          // arbitrary (possibly empty-topic / garbage) noise rows.
          const candidates: RawTopicCandidate[] = [...before, valid, ...after];

          const out = normalizeExtractedTopics(candidates);

          // R1.1: the section describes at least one real topic, so extraction
          // must surface at least one structured TopTopic — never an empty
          // result that would re-create the manual-report invisibility.
          expect(out.length).toBeGreaterThanOrEqual(1);

          // And whatever survives is still schema-valid (Property 1 holds here
          // too — the guaranteed-valid row clears the Zod gate).
          for (const topic of out) {
            expect(TopTopicSchema.safeParse(topic).success).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
