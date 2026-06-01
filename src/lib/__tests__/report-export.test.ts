import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  deriveSections,
  deriveFilenameBase,
  canExport,
} from '../report-export';

/**
 * Characters that are invalid in filenames on Windows or macOS, plus ASCII
 * control characters (0x00–0x1F). Mirrors `ILLEGAL_FILENAME_CHARS` in
 * `report-export.ts`. Used to assert the derived filename base is cross-OS-safe.
 */
const ILLEGAL_FILENAME_CHARS = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

function hasIllegalChar(value: string): boolean {
  for (const ch of ILLEGAL_FILENAME_CHARS) {
    if (value.includes(ch)) return true;
  }
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f) return true; // ASCII control chars 0x00–0x1F
  }
  return false;
}

/** A title arbitrary that mixes empty, ASCII, illegal, Chinese, and unicode. */
const titleArb = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.string(),
  // Chinese + unicode + illegal chars to stress sanitization
  fc.stringMatching(/^[\u4e00-\u9fff a-zA-Z0-9\\/:*?"<>|\u0000-\u001F]*$/),
  fc.constantFrom(
    '账户健康雷达报告',
    'Report: 2025/01 <draft>',
    'a*b?c|d"e',
    '🚀 unicode 报告 \u0001',
  ),
);

describe('report-export', () => {
  // Feature: report-view-ui-and-pdf-export, Property 1: Section derivation is complete and order-preserving
  it('Property 1: deriveSections is complete and order-preserving', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ title: titleArb }), { maxLength: 6 }),
        (modules) => {
          const sections = deriveSections(modules);

          // same length as input
          expect(sections).toHaveLength(modules.length);

          for (let i = 0; i < modules.length; i++) {
            // preserves title order (i-th output title === i-th input title)
            expect(sections[i].title).toBe(modules[i].title);
            // i-th output id === `module-${i}`
            expect(sections[i].id).toBe(`module-${i}`);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: report-view-ui-and-pdf-export, Property 2: Derived filename base is cross-OS-safe and never empty
  it('Property 2: deriveFilenameBase is cross-OS-safe and never empty', () => {
    fc.assert(
      fc.property(
        titleArb,
        fc.string(),
        // non-empty reportId
        fc.string({ minLength: 1 }),
        (title, dateRange, reportId) => {
          const base = deriveFilenameBase({ title, dateRange, reportId });

          // returns a non-empty string
          expect(base.length).toBeGreaterThan(0);

          // contains none of the illegal chars / ASCII control chars
          expect(hasIllegalChar(base)).toBe(false);

          // when title AND dateRange are both empty/whitespace-only, the result
          // is derived from reportId (still non-empty and illegal-char-free).
          if (title.trim() === '' && dateRange.trim() === '') {
            expect(base.length).toBeGreaterThan(0);
            expect(hasIllegalChar(base)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  describe('canExport truth table', () => {
    const statuses = ['published', 'draft', 'archived'] as const;
    const adminFlags = [true, false] as const;

    for (const status of statuses) {
      for (const isAdmin of adminFlags) {
        const expected = status === 'published';
        it(`status=${status}, isAdmin=${isAdmin} -> ${expected}`, () => {
          expect(canExport(status, isAdmin)).toBe(expected);
        });
      }
    }
  });

  describe('deriveSections examples', () => {
    it('returns [] for an empty module list', () => {
      expect(deriveSections([])).toEqual([]);
    });

    it('maps titles to module-${i} ids in order', () => {
      expect(
        deriveSections([{ title: 'Intro' }, { title: '账户健康' }]),
      ).toEqual([
        { id: 'module-0', title: 'Intro' },
        { id: 'module-1', title: '账户健康' },
      ]);
    });
  });

  describe('deriveFilenameBase examples', () => {
    it('combines a known title and dateRange into a readable base', () => {
      expect(
        deriveFilenameBase({
          title: 'Account Health Radar',
          dateRange: '2025-01-01 to 2025-01-31',
          reportId: 'abc-123',
        }),
      ).toBe('Account Health Radar 2025-01-01 to 2025-01-31');
    });

    it('strips illegal chars from the combined base', () => {
      expect(
        deriveFilenameBase({
          title: 'Q1/Q2: report?',
          dateRange: '<2025>',
          reportId: 'abc-123',
        }),
      ).toBe('Q1Q2 report 2025');
    });

    it('falls back to a reportId-derived value when title+dateRange are blank', () => {
      expect(
        deriveFilenameBase({
          title: '   ',
          dateRange: '',
          reportId: 'abc-123',
        }),
      ).toBe('report-abc-123');
    });
  });
});
