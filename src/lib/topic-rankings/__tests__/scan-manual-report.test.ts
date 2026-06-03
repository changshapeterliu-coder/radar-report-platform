import { describe, it, expect } from 'vitest';

import { buildScannedTopicsFromModule } from '../scan';
import type { ReportContent, TopTopic } from '@/types/report';

/**
 * Integration tests for the manual-report → publish-pipeline reuse path.
 *
 * Smart Paste now populates `module.topTopics[]` from a pasted top-topics
 * source (table OR prose, see `smart-paste-topic-extraction` spec). The whole
 * point of the feature is that a manual report then becomes *visible* to the
 * existing publish-time pipeline, whose single entry point is
 * `buildScannedTopicsFromModule` (`src/lib/topic-rankings/scan.ts`). These
 * tests assert that reuse: given a `ReportContent` carrying extracted
 * `topTopics`, the helper projects them into the 3-field `ScanTopic[]` shape
 * the shared canonicalize prompt consumes — with no second classification path.
 *
 * Field projection under test (from scan.ts):
 *   topic_name_zh ← topic     summary_zh ← seller_discussion     keywords ← keywords
 *
 * Spec: .kiro/specs/smart-paste-topic-extraction
 * Requirements: 4.1 (manual report no longer invisible),
 *               7.3 (admin edits carry into the pipeline),
 *               5.1 (empty topTopics → [] regression guard)
 */

/** Build a schema-shaped TopTopic with overridable fields. */
function makeTopTopic(overrides: Partial<TopTopic> = {}): TopTopic {
  return {
    rank: '1',
    topic: '账户暂停申诉',
    voice_volume: 0,
    keywords: ['账户暂停', '申诉'],
    seller_discussion: '卖家讨论账户被暂停后的申诉流程与等待时间。',
    severity: 'high',
    ...overrides,
  };
}

/** Build a ReportContent whose module 0 carries the given topTopics. */
function makeContent(modules: Array<Partial<TopTopic>[] | undefined>): ReportContent {
  return {
    title: '中国卖家账户健康雷达报告',
    dateRange: '2026-01-01 to 2026-01-07',
    modules: modules.map((topics, idx) => ({
      title: `Module ${idx}`,
      markdown: `## Module ${idx}\n\nsome prose body that is never mutated.`,
      topTopics: topics === undefined ? undefined : topics.map((t) => makeTopTopic(t)),
    })),
  };
}

describe('buildScannedTopicsFromModule — manual report pipeline reuse', () => {
  // ── R4.1: module-0-with-topics → manual report is no longer invisible ──
  it('projects extracted topTopics in module 0 into a non-empty ScanTopic[] (R4.1)', () => {
    const content = makeContent([
      [
        {
          topic: '账户暂停申诉',
          seller_discussion: '卖家关注暂停后的申诉时效。',
          keywords: ['暂停', '申诉', '时效'],
        },
        {
          rank: '2',
          topic: '二审被拒',
          seller_discussion: '二审被拒后缺乏明确反馈渠道。',
          keywords: ['二审', '被拒'],
        },
      ],
      [], // module 1: no topics
    ]);

    const scanned = buildScannedTopicsFromModule(content, 0);

    // Non-empty: the pipeline now receives a payload (was [] before the feature).
    expect(scanned).toHaveLength(2);

    // Each entry carries exactly the projected 3 fields from the source TopTopic.
    expect(scanned[0]).toEqual({
      topic_name_zh: '账户暂停申诉',
      summary_zh: '卖家关注暂停后的申诉时效。',
      keywords: ['暂停', '申诉', '时效'],
    });
    expect(scanned[1]).toEqual({
      topic_name_zh: '二审被拒',
      summary_zh: '二审被拒后缺乏明确反馈渠道。',
      keywords: ['二审', '被拒'],
    });
  });

  // ── R7.3: admin edits carry into the pipeline ──
  it('reflects admin-edited topic / seller_discussion / keywords (R7.3)', () => {
    const content = makeContent([
      [
        {
          topic: '原始话题',
          seller_discussion: '原始摘要',
          keywords: ['原始关键词'],
        },
      ],
    ]);

    // Simulate an admin editing the extracted TopTopic in the editor before publish.
    const editedTopic = content.modules[0].topTopics![0];
    editedTopic.topic = '编辑后的话题';
    editedTopic.seller_discussion = '编辑后的卖家讨论摘要';
    editedTopic.keywords = ['编辑后关键词A', '编辑后关键词B'];

    const scanned = buildScannedTopicsFromModule(content, 0);

    // The pipeline reads the EDITED values, not the originally extracted ones.
    expect(scanned).toHaveLength(1);
    expect(scanned[0]).toEqual({
      topic_name_zh: '编辑后的话题',
      summary_zh: '编辑后的卖家讨论摘要',
      keywords: ['编辑后关键词A', '编辑后关键词B'],
    });
  });

  // ── R5.1: all-empty → [] (pre-feature contract preserved) ──
  it('returns [] when every module has topTopics: [] (R5.1 regression guard)', () => {
    const content = makeContent([[], [], []]);

    expect(buildScannedTopicsFromModule(content, 0)).toEqual([]);
    expect(buildScannedTopicsFromModule(content, 1)).toEqual([]);
    expect(buildScannedTopicsFromModule(content, 2)).toEqual([]);
  });

  // ── R5.1 corollary: undefined topTopics also yields [] (no fabrication) ──
  it('returns [] when a module omits topTopics entirely (R5.1)', () => {
    const content = makeContent([undefined, undefined]);

    expect(buildScannedTopicsFromModule(content, 0)).toEqual([]);
    expect(buildScannedTopicsFromModule(content, 1)).toEqual([]);
  });
});
