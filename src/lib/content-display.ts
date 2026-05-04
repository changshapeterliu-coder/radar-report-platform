/**
 * Single source of truth for picking which language version of stored
 * content to render on a page. Everywhere in /reports, /news, /dashboard
 * should go through these helpers instead of hand-rolling the fallback
 * logic (current state: each page reimplements it slightly differently).
 *
 * Principle 3: bilingual is a first-class concern — the render path must
 * not forget to check content_translated.
 */

import type { ReportContent } from '@/types/report';

type Lang = 'zh' | 'en';

function normalizeLang(lang: string | undefined | null): Lang {
  return lang === 'en' ? 'en' : 'zh';
}

// ─── Reports ─────────────────────────────────────────────────────────

export interface ReportRowLike {
  content: ReportContent;
  content_translated?: ReportContent | null;
  title?: string;
  date_range?: string | null;
}

/**
 * Pick the ReportContent to render. If UI lang is EN and a translated
 * version exists (with at least a title and a modules array), use it.
 * Otherwise fall back to the original (assumed zh).
 */
export function getDisplayReportContent(
  row: ReportRowLike,
  lang: string | undefined
): ReportContent {
  const normalized = normalizeLang(lang);
  if (normalized === 'en' && isUsableContent(row.content_translated)) {
    return row.content_translated as ReportContent;
  }
  return row.content;
}

/**
 * Pick a display title for a Report row. Prefers translated title when
 * lang=en, otherwise falls back to the content.title, then the DB title.
 */
export function getDisplayReportTitle(
  row: ReportRowLike,
  lang: string | undefined
): string {
  const normalized = normalizeLang(lang);
  if (normalized === 'en' && isUsableContent(row.content_translated)) {
    const t = row.content_translated?.title;
    if (typeof t === 'string' && t.trim().length > 0) return t;
  }
  return row.content?.title ?? row.title ?? '';
}

/**
 * Pick a display dateRange for a Report row.
 */
export function getDisplayReportDateRange(
  row: ReportRowLike,
  lang: string | undefined
): string {
  const normalized = normalizeLang(lang);
  if (normalized === 'en' && isUsableContent(row.content_translated)) {
    const dr = row.content_translated?.dateRange;
    if (typeof dr === 'string' && dr.trim().length > 0) return dr;
  }
  return row.content?.dateRange ?? row.date_range ?? '';
}

function isUsableContent(c: ReportContent | null | undefined): boolean {
  if (!c || typeof c !== 'object') return false;
  if (typeof c.title !== 'string' || c.title.trim().length === 0) return false;
  if (!Array.isArray(c.modules)) return false;
  return true;
}

// ─── News ────────────────────────────────────────────────────────────

export interface NewsRowLike {
  title: string;
  summary: string | null;
  content: string;
  content_translated?: {
    title?: string;
    summary?: string | null;
    content?: string;
  } | null;
}

export interface NewsDisplayFields {
  title: string;
  summary: string | null;
  content: string;
}

/**
 * Pick the news fields to render. If UI lang is EN and a translated
 * payload exists, use it (per-field fallback to original if any one
 * field is missing).
 */
export function getDisplayNewsFields(
  row: NewsRowLike,
  lang: string | undefined
): NewsDisplayFields {
  const normalized = normalizeLang(lang);
  const t = row.content_translated ?? null;
  const useTranslated = normalized === 'en' && t !== null;
  return {
    title:
      useTranslated && typeof t?.title === 'string' && t.title.trim().length > 0
        ? t.title
        : row.title,
    summary:
      useTranslated && t?.summary !== undefined
        ? (t.summary ?? row.summary)
        : row.summary,
    content:
      useTranslated &&
      typeof t?.content === 'string' &&
      t.content.trim().length > 0
        ? t.content
        : row.content,
  };
}
