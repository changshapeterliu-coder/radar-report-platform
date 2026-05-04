'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DEFAULT_PROMPTS, type PromptType } from './default-prompts';

const LABELS: Record<PromptType, string> = {
  engine_a_hot_radar: 'Engine A · Stage 1 Hot Radar (DeepSeek V3.2)',
  engine_b_hot_radar: 'Engine B · Stage 1 Hot Radar (Kimi K2)',
  shared_deep_dive: 'Stage 2 · Deep Dive (Shared)',
  synthesizer_prompt: 'Synthesizer · Outer Merge',
};

const HOT_RADAR_PLACEHOLDERS = [
  '{start_date}',
  '{end_date}',
  '{week_label}',
  '{domain_name}',
];

const DEEP_DIVE_PLACEHOLDERS = [
  '{start_date}',
  '{end_date}',
  '{week_label}',
  '{topic_input}',
  '{topic}',
  '{keywords}',
];

const SYNTHESIZER_REQUIRED_PLACEHOLDERS = ['{gemini_output}', '{kimi_output}'];

export interface PromptTemplateEditorProps {
  domainId: string;
  promptType: PromptType;
}

export function PromptTemplateEditor({
  domainId,
  promptType,
}: PromptTemplateEditorProps) {
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
    return (
      <p className="text-sm text-foreground-muted">
        Loading {LABELS[promptType]}...
      </p>
    );
  }

  const placeholders = isSynthesizer
    ? SYNTHESIZER_REQUIRED_PLACEHOLDERS
    : promptType === 'shared_deep_dive'
      ? DEEP_DIVE_PLACEHOLDERS
      : HOT_RADAR_PLACEHOLDERS;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground">
          {LABELS[promptType]}
        </h3>
        <Button variant="outline" size="sm" onClick={handleReset}>
          Reset to Default
        </Button>
      </div>

      <textarea
        value={currentText}
        onChange={(e) => setCurrentText(e.target.value)}
        rows={rows}
        spellCheck={false}
        className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 font-mono text-sm text-foreground transition-colors placeholder:text-foreground-subtle focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      />

      <p className="text-xs text-foreground-muted">
        {isSynthesizer ? 'Required placeholders: ' : 'Supported placeholders: '}
        {placeholders.map((ph, i) => (
          <span key={ph}>
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
              {ph}
            </code>
            {i < placeholders.length - 1 ? ' ' : ''}
          </span>
        ))}
      </p>

      {hasMissingRequired && (
        <p className="text-xs text-danger-fg">
          Missing required placeholder: {missingPlaceholders.join(', ')}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving || hasMissingRequired}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
        {error && <p className="text-sm text-danger-fg">{error}</p>}
        {success && (
          <p className="flex items-center gap-1 text-sm text-success-fg">
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            Saved
          </p>
        )}
      </div>
    </div>
  );
}
