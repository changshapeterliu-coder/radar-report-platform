import { describe, it, expect } from 'vitest';
import { validateReportContent } from '../content-validator';
import type { ReportContent } from '@/types/report';

function makeValidModule(title = 'Module') {
  return {
    title,
    tables: [],
    analysisSections: [],
    highlightBoxes: [],
  };
}

function makeValidRegularContent(): ReportContent {
  return {
    title: 'Regular Report',
    dateRange: 'Jan 01 to Jan 15, 2026',
    modules: [
      makeValidModule('Module 1'),
      makeValidModule('Module 2'),
      makeValidModule('Module 3'),
      makeValidModule('Module 4'),
    ],
  };
}

function makeValidTopicContent(): ReportContent {
  return {
    title: 'Topic Report',
    dateRange: 'Feb 01 to Feb 15, 2026',
    modules: [makeValidModule('Topic Module')],
  };
}

describe('validateReportContent', () => {
  // --- Valid inputs ---
  it('returns no errors for a valid regular report with 4 modules', () => {
    const errors = validateReportContent(makeValidRegularContent(), 'regular');
    expect(errors).toEqual([]);
  });

  it('returns no errors for a valid topic report with 1 module', () => {
    const errors = validateReportContent(makeValidTopicContent(), 'topic');
    expect(errors).toEqual([]);
  });

  it('returns no errors for a topic report with multiple modules', () => {
    const content = makeValidTopicContent();
    content.modules.push(makeValidModule('Extra'));
    const errors = validateReportContent(content, 'topic');
    expect(errors).toEqual([]);
  });

  // --- Top-level structure ---
  it('rejects null content', () => {
    const errors = validateReportContent(null, 'regular');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].path).toBe('content');
  });

  it('rejects non-object content', () => {
    const errors = validateReportContent('string', 'regular');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects missing title', () => {
    const content = makeValidRegularContent();
    (content as unknown as Record<string, unknown>).title = '';
    const errors = validateReportContent(content, 'regular');
    expect(errors.some((e) => e.path === 'content.title')).toBe(true);
  });

  it('rejects missing dateRange', () => {
    const content = makeValidRegularContent();
    (content as unknown as Record<string, unknown>).dateRange = '';
    const errors = validateReportContent(content, 'regular');
    expect(errors.some((e) => e.path === 'content.dateRange')).toBe(true);
  });

  it('rejects non-array modules', () => {
    const content = { title: 'T', dateRange: 'D', modules: 'not-array' };
    const errors = validateReportContent(content, 'regular');
    expect(errors.some((e) => e.path === 'content.modules')).toBe(true);
  });

  // --- Module count rules ---
  it('rejects regular report with fewer than 4 modules', () => {
    const content = makeValidRegularContent();
    content.modules = content.modules.slice(0, 3);
    const errors = validateReportContent(content, 'regular');
    expect(
      errors.some(
        (e) => e.path === 'content.modules' && e.message.includes('exactly 4')
      )
    ).toBe(true);
  });

  it('rejects regular report with more than 4 modules', () => {
    const content = makeValidRegularContent();
    content.modules.push(makeValidModule('Extra'));
    const errors = validateReportContent(content, 'regular');
    expect(
      errors.some(
        (e) => e.path === 'content.modules' && e.message.includes('exactly 4')
      )
    ).toBe(true);
  });

  it('rejects topic report with 0 modules', () => {
    const content = makeValidTopicContent();
    content.modules = [];
    const errors = validateReportContent(content, 'topic');
    expect(
      errors.some(
        (e) =>
          e.path === 'content.modules' && e.message.includes('at least 1')
      )
    ).toBe(true);
  });

  // --- Module validation ---
  it('rejects module with missing title', () => {
    const content = makeValidRegularContent();
    (content.modules[0] as unknown as Record<string, unknown>).title = '';
    const errors = validateReportContent(content, 'regular');
    expect(
      errors.some((e) => e.path === 'content.modules[0].title')
    ).toBe(true);
  });

  it('rejects non-object module', () => {
    const content = makeValidRegularContent();
    (content.modules as unknown[])[1] = null;
    const errors = validateReportContent(content, 'regular');
    expect(
      errors.some((e) => e.path === 'content.modules[1]')
    ).toBe(true);
  });

  // --- Table validation ---
  it('returns no errors for a module with valid tables', () => {
    const content = makeValidRegularContent();
    content.modules[0].tables = [
      {
        headers: ['A', 'B'],
        rows: [{ cells: [{ text: '1' }, { text: '2' }] }],
      },
    ];
    const errors = validateReportContent(content, 'regular');
    expect(errors).toEqual([]);
  });

  it('rejects table row with mismatched cell count', () => {
    const content = makeValidRegularContent();
    content.modules[0].tables = [
      {
        headers: ['A', 'B', 'C'],
        rows: [{ cells: [{ text: '1' }, { text: '2' }] }],
      },
    ];
    const errors = validateReportContent(content, 'regular');
    expect(
      errors.some(
        (e) =>
          e.path === 'content.modules[0].tables[0].rows[0].cells' &&
          e.message.includes('2 cells') &&
          e.message.includes('3 headers')
      )
    ).toBe(true);
  });

  it('rejects table with non-array headers', () => {
    const content = makeValidRegularContent();
    (content.modules[0] as unknown as Record<string, unknown>).tables = [
      { headers: 'not-array', rows: [] },
    ];
    const errors = validateReportContent(content, 'regular');
    expect(
      errors.some((e) =>
        e.path.includes('headers')
      )
    ).toBe(true);
  });

  it('rejects table with non-array rows', () => {
    const content = makeValidRegularContent();
    (content.modules[0] as unknown as Record<string, unknown>).tables = [
      { headers: ['A'], rows: 'not-array' },
    ];
    const errors = validateReportContent(content, 'regular');
    expect(
      errors.some((e) => e.path.includes('rows') && e.message.includes('array'))
    ).toBe(true);
  });

  // --- Structured error output ---
  it('returns errors with field, path, and message', () => {
    const errors = validateReportContent({}, 'regular');
    expect(errors.length).toBeGreaterThan(0);
    for (const err of errors) {
      expect(err).toHaveProperty('field');
      expect(err).toHaveProperty('path');
      expect(err).toHaveProperty('message');
      expect(typeof err.field).toBe('string');
      expect(typeof err.path).toBe('string');
      expect(typeof err.message).toBe('string');
    }
  });

  it('collects multiple errors at once', () => {
    // Missing title, dateRange, and wrong module count
    const content = { title: '', dateRange: '', modules: [] };
    const errors = validateReportContent(content, 'regular');
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});
