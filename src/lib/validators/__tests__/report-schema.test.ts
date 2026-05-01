import { describe, it, expect } from 'vitest';
import {
  parseReportContentStrict,
  formatSchemaErrorsForPrompt,
  isMarkdownModule,
  isV4Content,
  TopTopicSchema,
  TopToolSchema,
} from '../report-schema';

// ─────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────

function validV4Module() {
  return {
    title: 'Account Suspension Trends',
    markdown: '## 本周 Top 5\n\nsome prose',
    topTopics: [
      {
        rank: '1 ✓',
        topic: '关联账户被封',
        voice_volume: 2.0,
        keywords: ['关联', '封店'],
        seller_discussion: '卖家讨论',
        severity: 'high' as const,
        cross_engine_confirmed: true,
      },
    ],
  };
}

function validV4Content() {
  return {
    title: 'Account Health Radar Report · W17',
    dateRange: '2026-04-20 ~ 2026-04-26',
    modules: [validV4Module()],
  };
}

// ─────────────────────────────────────────────
// TopTopicSchema
// ─────────────────────────────────────────────

describe('TopTopicSchema', () => {
  it('accepts a valid topic with all fields', () => {
    const r = TopTopicSchema.safeParse({
      rank: '1 ✓',
      topic: '账户关联',
      voice_volume: 3.5,
      keywords: ['关联', '封店', '多店铺'],
      seller_discussion: '卖家讨论描述',
      severity: 'high',
      cross_engine_confirmed: true,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a topic without cross_engine_confirmed', () => {
    const r = TopTopicSchema.safeParse({
      rank: '3',
      topic: 't',
      voice_volume: 1,
      keywords: [],
      seller_discussion: '',
      severity: 'low',
    });
    expect(r.success).toBe(true);
  });

  it('rejects topic with severity outside enum', () => {
    const r = TopTopicSchema.safeParse({
      rank: '1',
      topic: 't',
      voice_volume: 1,
      keywords: [],
      seller_discussion: '',
      severity: 'critical',
    });
    expect(r.success).toBe(false);
  });

  it('rejects topic with negative voice_volume', () => {
    const r = TopTopicSchema.safeParse({
      rank: '1',
      topic: 't',
      voice_volume: -1,
      keywords: [],
      seller_discussion: '',
      severity: 'low',
    });
    expect(r.success).toBe(false);
  });

  it('rejects topic with empty rank string', () => {
    const r = TopTopicSchema.safeParse({
      rank: '',
      topic: 't',
      voice_volume: 1,
      keywords: [],
      seller_discussion: '',
      severity: 'low',
    });
    expect(r.success).toBe(false);
  });
});

// ─────────────────────────────────────────────
// TopToolSchema
// ─────────────────────────────────────────────

describe('TopToolSchema', () => {
  it('accepts valid tool', () => {
    const r = TopToolSchema.safeParse({
      tool_name: 'AHA',
      sentiment: 'mixed',
      voice_volume: 4,
      key_feedback_points: ['loading 慢', '结果不准'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid sentiment', () => {
    const r = TopToolSchema.safeParse({
      tool_name: 'AHA',
      sentiment: 'angry',
      voice_volume: 4,
      key_feedback_points: [],
    });
    expect(r.success).toBe(false);
  });
});

// ─────────────────────────────────────────────
// parseReportContentStrict
// ─────────────────────────────────────────────

describe('parseReportContentStrict', () => {
  it('accepts a fully valid v4 content', () => {
    const r = parseReportContentStrict(validV4Content());
    expect(r.ok).toBe(true);
  });

  it('accepts content with multiple modules, some without topTopics', () => {
    const content = {
      ...validV4Content(),
      modules: [
        validV4Module(),
        { title: 'Education Opportunities', markdown: 'text' },
      ],
    };
    const r = parseReportContentStrict(content);
    expect(r.ok).toBe(true);
  });

  it('rejects when markdown is missing', () => {
    const content = {
      ...validV4Content(),
      modules: [{ title: 't', topTopics: [] }],
    };
    const r = parseReportContentStrict(content);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.path.includes('markdown'))).toBe(true);
  });

  it('rejects when title is empty', () => {
    const content = { ...validV4Content(), title: '' };
    const r = parseReportContentStrict(content);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.path === 'title')).toBe(true);
  });

  it('surfaces deep-nested topTopics errors with readable paths', () => {
    const content = {
      ...validV4Content(),
      modules: [
        {
          ...validV4Module(),
          topTopics: [
            {
              rank: '1',
              topic: '',
              voice_volume: 1,
              keywords: [],
              seller_discussion: '',
              severity: 'high',
            },
          ],
        },
      ],
    };
    const r = parseReportContentStrict(content);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const topicErr = r.errors.find((e) => e.path.includes('topTopics'));
    expect(topicErr).toBeDefined();
    expect(topicErr!.path).toContain('topic');
  });

  it('rejects non-object root', () => {
    const r = parseReportContentStrict('not an object');
    expect(r.ok).toBe(false);
  });

  it('rejects when modules is not an array', () => {
    const r = parseReportContentStrict({
      title: 't',
      dateRange: 'd',
      modules: 'not-array',
    });
    expect(r.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────
// formatSchemaErrorsForPrompt
// ─────────────────────────────────────────────

describe('formatSchemaErrorsForPrompt', () => {
  it('formats a small error list as indented key: message lines', () => {
    const formatted = formatSchemaErrorsForPrompt([
      { path: 'modules.0.markdown', message: 'Required' },
      { path: 'modules.1.topTopics.0.severity', message: 'Invalid' },
    ]);
    expect(formatted).toContain('modules.0.markdown: Required');
    expect(formatted).toContain(
      'modules.1.topTopics.0.severity: Invalid'
    );
  });

  it('caps at 20 errors to avoid prompt bloat', () => {
    const errors = Array.from({ length: 50 }, (_, i) => ({
      path: `p${i}`,
      message: `m${i}`,
    }));
    const formatted = formatSchemaErrorsForPrompt(errors);
    expect(formatted.split('\n')).toHaveLength(20);
  });
});

// ─────────────────────────────────────────────
// isMarkdownModule / isV4Content
// ─────────────────────────────────────────────

describe('isMarkdownModule', () => {
  it('returns true for module with non-empty markdown', () => {
    expect(isMarkdownModule({ title: 't', markdown: 'hello' })).toBe(true);
  });

  it('returns false for module with empty markdown', () => {
    expect(isMarkdownModule({ title: 't', markdown: '' })).toBe(false);
  });

  it('returns false for legacy module with tables but no markdown', () => {
    expect(
      isMarkdownModule({ title: 't', tables: [{ headers: [], rows: [] }] })
    ).toBe(false);
  });

  it('returns false for null / non-object inputs', () => {
    expect(isMarkdownModule(null)).toBe(false);
    expect(isMarkdownModule('str')).toBe(false);
    expect(isMarkdownModule(undefined)).toBe(false);
  });
});

describe('isV4Content', () => {
  it('returns true when any module has markdown', () => {
    expect(
      isV4Content({
        title: 't',
        dateRange: 'd',
        modules: [
          { title: 'legacy', tables: [], analysisSections: [], highlightBoxes: [] },
          { title: 'new', markdown: 'body' },
        ] as never,
      })
    ).toBe(true);
  });

  it('returns false when all modules are legacy', () => {
    expect(
      isV4Content({
        title: 't',
        dateRange: 'd',
        modules: [
          { title: 'legacy', tables: [], analysisSections: [], highlightBoxes: [] },
        ] as never,
      })
    ).toBe(false);
  });

  it('returns false for null / undefined', () => {
    expect(isV4Content(null)).toBe(false);
    expect(isV4Content(undefined)).toBe(false);
  });
});
