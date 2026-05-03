'use client';

import { resolveText } from '@/lib/daily-alert/i18n-fallback';
import { NoveltyBadge } from './NoveltyBadge';

export interface PreviewTopic {
  topic_name_zh: string;
  topic_name_en: string | null;
  is_new_canonical: boolean;
}

export interface TopicPreviewListProps {
  topics: PreviewTopic[];
  lang: 'zh' | 'en';
}

/**
 * Pill-shaped list of the day's top topic names, inline NoveltyBadge when
 * the canonical class is first-seen. Used in the Top-Topic Preview cell.
 */
export function TopicPreviewList({ topics, lang }: TopicPreviewListProps) {
  if (!topics || topics.length === 0) {
    return <span className="text-gray-400">—</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {topics.map((topic, idx) => {
        const name = resolveText(topic.topic_name_zh, topic.topic_name_en, lang);
        return (
          <li
            key={idx}
            className="inline-flex items-center gap-0.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs"
          >
            <span className="truncate max-w-[180px] sm:max-w-[240px]" title={name.text}>
              {name.text}
            </span>
            {topic.is_new_canonical && <NoveltyBadge />}
          </li>
        );
      })}
    </ul>
  );
}
