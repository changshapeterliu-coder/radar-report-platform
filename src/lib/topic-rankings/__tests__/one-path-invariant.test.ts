import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildScannedTopicsFromModule } from '../scan';
import { runWeeklyCanonicalize } from '../canonicalize';
import { persistWeeklyTopicRankings } from '../persist';

/**
 * Smoke checks — one-path invariant and render parity.
 *
 * These are structural assertions, not behavioral tests. They lock in two
 * invariants this feature must NOT have broken:
 *
 *  1. ONE classification path (R4.5 / R9.4): a published report — manual or
 *     auto-run — reaches the dictionary/trending/news pipeline through the
 *     single chain
 *       buildScannedTopicsFromModule → runWeeklyCanonicalize → persistWeeklyTopicRankings
 *     with no second classification path and no parallel news-generation path.
 *
 *  2. RENDER parity (R8.2): `ReportRenderer` has no manual-vs-auto branch —
 *     both render their `topTopics` through the same `TopTopicsTable`, gated
 *     only on the presence of topics, never on report origin.
 *
 * The assertions are deliberately coarse-grained and pinned to stable markers
 * (import-identity + source-text presence/absence), so they fail loudly if a
 * future change introduces a parallel path or an origin-conditional render,
 * without being brittle to incidental edits.
 *
 * Spec: .kiro/specs/smart-paste-topic-extraction
 * Requirements: 4.5 (one classification path), 8.2 (render parity),
 *               9.4 (no parallel news-generation path)
 */

const REPO_ROOT = process.cwd();
const PUBLISH_ROUTE = join(
  REPO_ROOT,
  'src/app/api/reports/[id]/publish/route.ts'
);
const SCAN_SRC = join(REPO_ROOT, 'src/lib/topic-rankings/scan.ts');
const REPORT_RENDERER = join(
  REPO_ROOT,
  'src/components/report/ReportRenderer.tsx'
);

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Count non-overlapping occurrences of a literal substring. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
}

describe('one-path invariant — single classification chain (R4.5 / R9.4)', () => {
  // ── The three chain functions exist and are wired as the only entry points ──
  it('exposes the exact chain functions buildScannedTopicsFromModule → runWeeklyCanonicalize → persistWeeklyTopicRankings', () => {
    expect(typeof buildScannedTopicsFromModule).toBe('function');
    expect(typeof runWeeklyCanonicalize).toBe('function');
    expect(typeof persistWeeklyTopicRankings).toBe('function');
  });

  it('publish route wires extraction through the single chain', () => {
    const src = read(PUBLISH_ROUTE);

    // All three chain functions are imported/referenced by the publish route.
    expect(src).toContain('buildScannedTopicsFromModule');
    expect(src).toContain('runWeeklyCanonicalize');
    expect(src).toContain('persistWeeklyTopicRankings');

    // The canonicalize block is invoked exactly once — a single entry into
    // the classification pipeline, no second canonicalize call site.
    expect(countOccurrences(src, 'runCanonicalizeBlock(id, report)')).toBe(1);

    // buildScannedTopicsFromModule is the ONLY scan entry — invoked, and the
    // scanned-topics payload is built only from it (no alternative scanner).
    expect(src).toContain('buildScannedTopicsFromModule(reportContent, moduleIndex)');
  });

  it('scan.ts is a pure projection — no second classification (no LLM) path', () => {
    const src = read(SCAN_SRC);

    // scan.ts exports exactly one function: the single scan entry point.
    expect(countOccurrences(src, 'export function')).toBe(1);
    expect(src).toContain('export function buildScannedTopicsFromModule');

    // It does NOT classify — no LLM/network call lives in the scan path.
    // Classification is owned solely by runWeeklyCanonicalize downstream.
    expect(src).not.toContain('fetch(');
    expect(src.toLowerCase()).not.toContain('openrouter');
  });

  // ── R9.4: AI Insight news is a single, report-owned generation path ──
  it('AI Insight news uses one report-owned generation path (idempotent replace, no parallel path)', () => {
    const src = read(PUBLISH_ROUTE);

    // The ownership link (report_id) is set on the AI Insight insert — this is
    // what makes the replace/cascade enforceable at the data layer (R9.3),
    // and what keeps it a single owned path rather than an append-only one.
    expect(src).toContain('report_id: id');

    // Idempotent replace: delete this report's existing AI Insight rows before
    // (re)generating. Mirrors persist_weekly_topic_rankings' DELETE-by-report_id.
    expect(src).toContain(".eq('report_id', id)");
    expect(src).toContain(".eq('source_channel', 'AI Insight')");

    // Exactly one AI Insight news INSERT path (single generation path, R9.4).
    expect(countOccurrences(src, "source_channel: 'AI Insight'")).toBe(1);
  });
});

describe('render parity — no manual-vs-auto branch in ReportRenderer (R8.2)', () => {
  const src = read(REPORT_RENDERER);

  it('renders topTopics through a single TopTopicsTable site', () => {
    // TopTopicsTable is the structured render path for topics.
    expect(src).toContain('<TopTopicsTable');
    // Exactly one JSX render site, driven directly by the module's topTopics
    // (not a per-origin variant) — both manual and auto-run reports flow
    // through it. Pinned to the `topics={module.topTopics` marker because the
    // bare `<TopTopicsTable` string also appears in a JSDoc comment.
    expect(countOccurrences(src, 'topics={module.topTopics')).toBe(1);
  });

  it('gates the structured table only on presence of topics, never on report origin', () => {
    // The single gate is the presence of topTopics …
    expect(src).toContain('module.topTopics.length > 0');
    expect(src).toContain('hasTopTopics && (');

    // … and there is NO origin-conditional rendering of topics. Guard against
    // a future manual-vs-auto branch sneaking in around the table.
    const lowered = src.toLowerCase();
    expect(lowered).not.toContain('ismanual');
    expect(lowered).not.toContain('isauto');
    expect(lowered).not.toContain("=== 'manual'");
    expect(lowered).not.toContain('=== "manual"');
    expect(lowered).not.toContain("origin ===");
    expect(lowered).not.toContain('report.origin');
  });
});
