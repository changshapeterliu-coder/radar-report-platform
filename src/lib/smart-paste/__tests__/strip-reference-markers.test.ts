import { describe, it, expect } from 'vitest';
import { stripReferenceMarkers } from '../strip-reference-markers';

// Feature: smart-paste-topic-extraction — reference-marker stripping
// Real samples pulled from the user's Gemini Deep Research output (prose + docx
// table forms). The contract: every dangling " N" citation is removed; every
// real number stays.

describe('stripReferenceMarkers — removes dangling citations', () => {
  it('removes a marker before a full-width period, keeping the char', () => {
    expect(stripReferenceMarkers('主动控制权 1。')).toBe('主动控制权。');
    expect(stripReferenceMarkers('行业陋习 1。')).toBe('行业陋习。');
    expect(stripReferenceMarkers('强监管清场动作 1。')).toBe('强监管清场动作。');
  });

  it('removes a marker at end of line / string', () => {
    expect(stripReferenceMarkers('真实性审核 1')).toBe('真实性审核');
    expect(stripReferenceMarkers('KYC验证 6')).toBe('KYC验证');
  });

  it('removes a marker glued to a keyword list cell', () => {
    expect(stripReferenceMarkers('重复违规, 知识产权投诉, 180天上限, 绿标封号 3')).toBe(
      '重复违规, 知识产权投诉, 180天上限, 绿标封号'
    );
    expect(
      stripReferenceMarkers('mufus关联, 地址关联, 营业执照变更, 意大利5万欧保证金 1')
    ).toBe('mufus关联, 地址关联, 营业执照变更, 意大利5万欧保证金');
  });

  it('removes a marker after a closing quote / bracket', () => {
    expect(stripReferenceMarkers('不要看下面’ 1。')).toBe('不要看下面’。');
  });
});

describe('stripReferenceMarkers — preserves real data (no collateral damage)', () => {
  const mustSurvive: Array<[string, string]> = [
    ['《协议》第3条', '《协议》第3条'],
    ['同行17号刚通过虚拟视频认证', '同行17号刚通过虚拟视频认证'],
    ['申诉通过率通常低于15%', '申诉通过率通常低于15%'],
    ['平均账户解封周期在35天以上', '平均账户解封周期在35天以上'],
    ['3000欧元以上的高额罚款', '3000欧元以上的高额罚款'],
    ['绿色的260分', '绿色的260分'],
    ['180天内重复', '180天内重复'],
    ['仅给予3天的宽限申诉期', '仅给予3天的宽限申诉期'],
    ['72小时内成功申诉', '72小时内成功申诉'],
    ['意大利5万欧保证金', '意大利5万欧保证金'],
    ['2026年5月18日新规', '2026年5月18日新规'],
    ['5/18参考价格', '5/18参考价格'],
    ['200分（绿标）', '200分（绿标）'],
    ['货值大于150欧元', '货值大于150欧元'],
    ['30天内发起移除', '30天内发起移除'],
    ['过去90天内超过一半时间', '过去90天内超过一半时间'],
  ];

  it.each(mustSurvive)('keeps %s unchanged', (input, expected) => {
    expect(stripReferenceMarkers(input)).toBe(expected);
  });

  it('does not touch English "Section 3" / "Top 1" / "Module 2"', () => {
    expect(stripReferenceMarkers('BSA Section 3 Violations')).toBe(
      'BSA Section 3 Violations'
    );
    expect(stripReferenceMarkers('Top 1')).toBe('Top 1');
    expect(stripReferenceMarkers('模块 1：封号趋势分析')).toBe('模块 1：封号趋势分析');
  });
});

describe('stripReferenceMarkers — properties', () => {
  it('is idempotent', () => {
    const s = '真实性审核 1。卖家热贴 1。低于15%的通过率';
    const once = stripReferenceMarkers(s);
    expect(stripReferenceMarkers(once)).toBe(once);
  });

  it('handles empty / falsy input', () => {
    expect(stripReferenceMarkers('')).toBe('');
  });

  it('strips a multi-paragraph real sample to zero dangling markers', () => {
    const sample = [
      '· 政策盲区：卖家普遍忽略了《亚马逊服务商业解决方案协议》第3条的底层执行逻辑，该条款赋予平台主动控制权 1。',
      '· 风险量化：申诉通过率通常低于15%，平均账户解封周期在35天以上，部分站点面临3000欧元以上的罚款 1。',
      '商业解决方案协议第3条, 扫号, 视频核验, 真实性审核 1',
    ].join('\n');
    const out = stripReferenceMarkers(sample);
    // no " <digit>" left at any sentence boundary
    expect(out).not.toMatch(/[\u4e00-\u9fff][ \u00a0]\d{1,3}(?=[。，\n]|$)/u);
    // real numbers survived
    expect(out).toContain('第3条');
    expect(out).toContain('低于15%');
    expect(out).toContain('35天以上');
    expect(out).toContain('3000欧元');
  });
});
