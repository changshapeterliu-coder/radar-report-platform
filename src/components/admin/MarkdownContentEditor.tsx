'use client';

import { useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type {
  ReportContent,
  ReportModule,
  TopTopic,
} from '@/types/report';

// MDEditor uses window, so it has to be client-only.
const MDEditor = dynamic(
  () => import('@uiw/react-md-editor').then((m) => m.default),
  { ssr: false }
);

/**
 * MarkdownContentEditor — the v4 admin editor.
 *
 * For each module:
 *   - a compact structured form for `topTopics` (Rank / Topic / Voice Volume /
 *     Keywords / Severity) — validated inline
 *   - a Live Preview Markdown editor for `markdown` body
 *
 * This is used when admin opens a v4-shaped draft. Pre-v4 drafts still
 * route through the legacy ContentEditor.
 */

const SEVERITY_OPTIONS: Array<{ value: TopTopic['severity']; label: string }> = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
];

function emptyTopic(rank = 1): TopTopic {
  return {
    rank: String(rank),
    topic: '',
    voice_volume: 0,
    keywords: [],
    seller_discussion: '',
    severity: 'medium',
  };
}

function TopTopicRow({
  topic,
  index,
  onChange,
  onRemove,
}: {
  topic: TopTopic;
  index: number;
  onChange: (t: TopTopic) => void;
  onRemove: () => void;
}) {
  const update = (patch: Partial<TopTopic>) => onChange({ ...topic, ...patch });

  return (
    <tr>
      <td className="p-1">
        <input
          value={topic.rank}
          onChange={(e) => update({ rank: e.target.value })}
          className="w-12 rounded border px-1 py-1 text-xs text-center"
          placeholder="1"
          aria-label={`topic-${index}-rank`}
        />
      </td>
      <td className="p-1">
        <input
          value={topic.topic}
          onChange={(e) => update({ topic: e.target.value })}
          className="w-full rounded border px-2 py-1 text-xs"
          placeholder="topic"
        />
      </td>
      <td className="p-1">
        <input
          type="number"
          step="0.1"
          min="0"
          value={topic.voice_volume}
          onChange={(e) => update({ voice_volume: Number(e.target.value) })}
          className="w-16 rounded border px-1 py-1 text-xs text-right"
        />
      </td>
      <td className="p-1">
        <input
          value={topic.keywords.join('、')}
          onChange={(e) =>
            update({
              keywords: e.target.value
                .split(/[、,，]/)
                .map((k) => k.trim())
                .filter(Boolean),
            })
          }
          className="w-full rounded border px-2 py-1 text-xs"
          placeholder="用、分隔"
        />
      </td>
      <td className="p-1">
        <input
          value={topic.seller_discussion}
          onChange={(e) => update({ seller_discussion: e.target.value })}
          className="w-full rounded border px-2 py-1 text-xs"
          placeholder="卖家讨论描述"
        />
      </td>
      <td className="p-1">
        <select
          value={topic.severity}
          onChange={(e) =>
            update({ severity: e.target.value as TopTopic['severity'] })
          }
          className="rounded border text-xs px-1 py-1"
        >
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </td>
      <td className="p-1">
        <label className="flex items-center gap-1 text-[11px] text-gray-600">
          <input
            type="checkbox"
            checked={!!topic.cross_engine_confirmed}
            onChange={(e) => update({ cross_engine_confirmed: e.target.checked })}
          />
          ✓
        </label>
      </td>
      <td className="p-1">
        <button
          onClick={onRemove}
          className="text-red-400 hover:text-red-600 text-xs"
          aria-label={`remove-topic-${index}`}
        >
          ×
        </button>
      </td>
    </tr>
  );
}

function TopTopicsEditor({
  topics,
  onChange,
}: {
  topics: TopTopic[];
  onChange: (topics: TopTopic[]) => void;
}) {
  const updateAt = (i: number, t: TopTopic) => {
    onChange(topics.map((x, idx) => (idx === i ? t : x)));
  };
  const removeAt = (i: number) => {
    onChange(topics.filter((_, idx) => idx !== i));
  };
  const add = () => onChange([...topics, emptyTopic(topics.length + 1)]);

  return (
    <div className="border rounded p-3 mb-3 bg-gray-50">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-[#232f3e]">Top Topics</p>
        <button onClick={add} className="text-xs text-[#146eb4] hover:underline">
          + Add topic
        </button>
      </div>
      {topics.length === 0 ? (
        <p className="text-xs text-gray-400">No topics — click "+ Add topic".</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-gray-500">
                <th className="p-1 text-left w-12">Rank</th>
                <th className="p-1 text-left">Topic</th>
                <th className="p-1 text-left w-16">热度</th>
                <th className="p-1 text-left">Keywords</th>
                <th className="p-1 text-left">卖家讨论</th>
                <th className="p-1 text-left w-12">严重</th>
                <th className="p-1 text-left w-12">双印</th>
                <th className="p-1 w-8" />
              </tr>
            </thead>
            <tbody>
              {topics.map((t, i) => (
                <TopTopicRow
                  key={i}
                  topic={t}
                  index={i}
                  onChange={(next) => updateAt(i, next)}
                  onRemove={() => removeAt(i)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ModuleEditor({
  module,
  onChange,
  onRemove,
  showRemove,
}: {
  module: ReportModule;
  onChange: (m: ReportModule) => void;
  onRemove: () => void;
  showRemove: boolean;
}) {
  const setMarkdown = useCallback(
    (md: string | undefined) => onChange({ ...module, markdown: md ?? '' }),
    [module, onChange]
  );
  const setTopTopics = (next: TopTopic[]) =>
    onChange({ ...module, topTopics: next });

  return (
    <div className="border rounded-lg p-4 mb-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <input
          value={module.title}
          onChange={(e) => onChange({ ...module, title: e.target.value })}
          className="flex-1 mr-3 rounded border px-3 py-2 text-sm font-bold"
          placeholder="Module title"
        />
        {showRemove && (
          <button
            onClick={onRemove}
            className="text-red-500 hover:text-red-700 text-sm"
          >
            Remove Module
          </button>
        )}
      </div>

      {/* Subtitle */}
      <input
        value={module.subtitle ?? ''}
        onChange={(e) => onChange({ ...module, subtitle: e.target.value })}
        className="w-full rounded border px-3 py-2 text-sm mb-3"
        placeholder="Subtitle (optional)"
      />

      {/* Top Topics structured editor */}
      <TopTopicsEditor
        topics={module.topTopics ?? []}
        onChange={setTopTopics}
      />

      {/* Markdown body with live preview */}
      <p className="text-sm font-semibold text-[#232f3e] mb-1">Markdown Body</p>
      <p className="text-xs text-gray-500 mb-2">
        支持 GitHub-style 表格、引用、标题。特殊 callout:{' '}
        <code className="bg-gray-100 rounded px-1">&gt; [!INSIGHT]</code>{' '}
        <code className="bg-gray-100 rounded px-1">&gt; [!WARNING]</code>{' '}
        <code className="bg-gray-100 rounded px-1">&gt; [!RECOMMENDATION]</code>
      </p>
      <div data-color-mode="light">
        <MDEditor
          value={module.markdown ?? ''}
          onChange={setMarkdown}
          height={380}
          preview="live"
        />
      </div>
    </div>
  );
}

export interface MarkdownContentEditorProps {
  value: ReportContent;
  onChange: (content: ReportContent) => void;
}

export default function MarkdownContentEditor({
  value,
  onChange,
}: MarkdownContentEditorProps) {
  const modules = useMemo(
    () => (Array.isArray(value.modules) ? value.modules : []),
    [value.modules]
  );

  const updateModule = useCallback(
    (i: number, m: ReportModule) => {
      onChange({ ...value, modules: modules.map((x, idx) => (idx === i ? m : x)) });
    },
    [value, onChange, modules]
  );

  const removeModule = useCallback(
    (i: number) => {
      onChange({ ...value, modules: modules.filter((_, idx) => idx !== i) });
    },
    [value, onChange, modules]
  );

  const addModule = useCallback(() => {
    const newModule: ReportModule = {
      title: 'New Module',
      markdown: '',
      topTopics: [],
    };
    onChange({ ...value, modules: [...modules, newModule] });
  }, [value, onChange, modules]);

  return (
    <div>
      <h2 className="text-lg font-bold text-[#232f3e] mb-4">Content Editor (Markdown)</h2>
      {modules.map((m, i) => (
        <ModuleEditor
          key={i}
          module={m}
          onChange={(next) => updateModule(i, next)}
          onRemove={() => removeModule(i)}
          showRemove={modules.length > 1}
        />
      ))}
      <button
        onClick={addModule}
        className="w-full rounded border-2 border-dashed border-gray-300 py-3 text-sm text-gray-500 hover:border-[#ff9900] hover:text-[#ff9900] transition-colors"
      >
        + Add Module
      </button>
    </div>
  );
}
