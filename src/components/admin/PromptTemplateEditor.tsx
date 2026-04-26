'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_PROMPTS, type PromptType } from './default-prompts';

const LABELS: Record<PromptType, string> = {
  gemini_prompt: 'Gemini Prompt (English)',
  kimi_prompt: 'Kimi Prompt (Chinese)',
  synthesizer_prompt: 'Synthesizer Prompt (Meta)',
};

const RESEARCHER_PLACEHOLDERS = [
  '{start_date}',
  '{end_date}',
  '{week_label}',
  '{domain_name}',
  '{subquestion}',
];

const SYNTHESIZER_REQUIRED_PLACEHOLDERS = ['{gemini_output}', '{kimi_output}'];

export interface PromptTemplateEditorProps {
  domainId: string;
  promptType: PromptType;
}

export function PromptTemplateEditor({ domainId, promptType }: PromptTemplateEditorProps) {
  const defaultText = DEFAULT_PROMPTS[promptType];

  const [currentText, setCurrentText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/prompt-templates?domain_id=${encodeURIComponent(domainId)}`,
          { cache: 'no-store' }
        );
        if (!res.ok) {
          throw new Error(`Failed to load prompt templates (${res.status})`);
        }
        const json = await res.json();
        if (cancelled) return;
        const shaped = json?.data as Record<PromptType, string | null> | null;
        const text = shaped?.[promptType] ?? defaultText;
        setCurrentText(text);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [domainId, promptType, defaultText]);

  useEffect(() => {
    if (!success) return;
    const t = window.setTimeout(() => setSuccess(false), 3000);
    return () => window.clearTimeout(t);
  }, [success]);

  const isSynthesizer = promptType === 'synthesizer_prompt';
  const missingPlaceholders = isSynthesizer
    ? SYNTHESIZER_REQUIRED_PLACEHOLDERS.filter((ph) => !currentText.includes(ph))
    : [];
  const hasMissingRequired = missingPlaceholders.length > 0;

  const rows = isSynthesizer ? 40 : 30;

  const handleReset = () => {
    setCurrentText(defaultText);
    setSuccess(false);
    setError(null);
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(false);
    if (hasMissingRequired) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/prompt-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain_id: domainId,
          prompt_type: promptType,
          template_text: currentText,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `Save failed (${res.status})`);
      }
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-500">Loading {LABELS[promptType]}...</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-[#232f3e]">{LABELS[promptType]}</h3>
        <button
          type="button"
          onClick={handleReset}
          className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-[#232f3e] hover:bg-gray-50"
        >
          Reset to Default
        </button>
      </div>

      <textarea
        value={currentText}
        onChange={(e) => setCurrentText(e.target.value)}
        rows={rows}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono resize-y focus:border-[#ff9900] focus:outline-none"
        spellCheck={false}
      />

      {isSynthesizer ? (
        <p className="text-xs text-gray-500">
          Required placeholders: <code className="font-mono">{'{gemini_output}'}</code>{' '}
          <code className="font-mono">{'{kimi_output}'}</code>
        </p>
      ) : (
        <p className="text-xs text-gray-500">
          Supported placeholders:{' '}
          {RESEARCHER_PLACEHOLDERS.map((ph, i) => (
            <span key={ph}>
              <code className="font-mono">{ph}</code>
              {i < RESEARCHER_PLACEHOLDERS.length - 1 ? ' ' : ''}
            </span>
          ))}
        </p>
      )}

      {hasMissingRequired && (
        <p className="text-xs text-red-600">
          Missing required placeholder: {missingPlaceholders.join(', ')}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || hasMissingRequired}
          className="rounded bg-[#ff9900] px-4 py-2 text-sm font-medium text-white hover:bg-[#e88b00] disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">Saved ✓</p>}
      </div>
    </div>
  );
}
