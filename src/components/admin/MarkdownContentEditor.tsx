'use client';

import { useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Plus, X } from 'lucide-react';
import type { ReportContent, ReportModule, TopTopic } from '@/types/report';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

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
    <tr className="align-top">
      <td className="p-1">
        <Input
          value={topic.rank}
          onChange={(e) => update({ rank: e.target.value })}
          className="h-8 w-12 text-center text-xs"
          placeholder="1"
          aria-label={`topic-${index}-rank`}
        />
      </td>
      <td className="p-1">
        <Input
          value={topic.topic}
          onChange={(e) => update({ topic: e.target.value })}
          className="h-8 w-full text-xs"
          placeholder="topic"
        />
      </td>
      <td className="p-1">
        <Input
          type="number"
          step="0.1"
          min="0"
          value={topic.voice_volume}
          onChange={(e) => update({ voice_volume: Number(e.target.value) })}
          className="h-8 w-16 text-right text-xs"
        />
      </td>
      <td className="p-1">
        <Input
          value={topic.keywords.join('、')}
          onChange={(e) =>
            update({
              keywords: e.target.value
                .split(/[、,，]/)
                .map((k) => k.trim())
                .filter(Boolean),
            })
          }
          className="h-8 w-full text-xs"
          placeholder="用、分隔"
        />
      </td>
      <td className="p-1">
        <Input
          value={topic.seller_discussion}
          onChange={(e) => update({ seller_discussion: e.target.value })}
          className="h-8 w-full text-xs"
          placeholder="卖家讨论描述"
        />
      </td>
      <td className="p-1">
        <Select
          value={topic.severity}
          onChange={(e) =>
            update({ severity: e.target.value as TopTopic['severity'] })
          }
          className="h-8 w-full text-xs"
        >
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </td>
      <td className="p-1">
        <label className="flex items-center gap-1 text-[11px] text-foreground-muted">
          <input
            type="checkbox"
            checked={!!topic.cross_engine_confirmed}
            onChange={(e) =>
              update({ cross_engine_confirmed: e.target.checked })
            }
            className="h-3.5 w-3.5 accent-primary"
          />
          ✓
        </label>
      </td>
      <td className="p-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-foreground-muted hover:text-danger-fg"
          onClick={onRemove}
          aria-label={`remove-topic-${index}`}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </Button>
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
    <div className="mb-3 rounded-md border border-border bg-muted/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Top Topics</p>
        <Button variant="link" size="sm" onClick={add}>
          <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Add topic
        </Button>
      </div>
      {topics.length === 0 ? (
        <p className="text-xs text-foreground-subtle">
          No topics — click &ldquo;+ Add topic&rdquo;.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-foreground-muted">
                <th className="w-12 p-1 text-left font-medium">Rank</th>
                <th className="p-1 text-left font-medium">Topic</th>
                <th className="w-16 p-1 text-left font-medium">热度</th>
                <th className="p-1 text-left font-medium">Keywords</th>
                <th className="p-1 text-left font-medium">卖家讨论</th>
                <th className="w-20 p-1 text-left font-medium">严重</th>
                <th className="w-12 p-1 text-left font-medium">双印</th>
                <th className="w-8 p-1" />
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
    <div className="mb-4 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Input
          value={module.title}
          onChange={(e) => onChange({ ...module, title: e.target.value })}
          className="flex-1 text-sm font-semibold"
          placeholder="Module title"
        />
        {showRemove && (
          <Button
            variant="ghost"
            size="sm"
            className="text-danger-fg hover:bg-danger-bg hover:text-danger-fg"
            onClick={onRemove}
          >
            Remove Module
          </Button>
        )}
      </div>

      {/* Subtitle */}
      <Input
        value={module.subtitle ?? ''}
        onChange={(e) => onChange({ ...module, subtitle: e.target.value })}
        className="mb-3"
        placeholder="Subtitle (optional)"
      />

      {/* Top Topics structured editor */}
      <TopTopicsEditor
        topics={module.topTopics ?? []}
        onChange={setTopTopics}
      />

      {/* Markdown body with live preview */}
      <p className="mb-1 text-sm font-semibold text-foreground">Markdown Body</p>
      <p className="mb-2 text-xs leading-relaxed text-foreground-muted">
        支持 GitHub-style 表格、引用、标题。特殊 callout:{' '}
        <code className="rounded bg-muted px-1 font-mono text-[11px] text-foreground">
          &gt; [!INSIGHT]
        </code>{' '}
        <code className="rounded bg-muted px-1 font-mono text-[11px] text-foreground">
          &gt; [!WARNING]
        </code>{' '}
        <code className="rounded bg-muted px-1 font-mono text-[11px] text-foreground">
          &gt; [!RECOMMENDATION]
        </code>
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
      onChange({
        ...value,
        modules: modules.map((x, idx) => (idx === i ? m : x)),
      });
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
      <h2 className="mb-4 text-lg font-semibold text-foreground">
        Content Editor (Markdown)
      </h2>
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
        type="button"
        onClick={addModule}
        className="w-full rounded-md border-2 border-dashed border-border py-3 text-sm text-foreground-muted transition-colors hover:border-primary hover:text-primary"
      >
        + Add Module
      </button>
    </div>
  );
}
