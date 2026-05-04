'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Toast, type ToastState } from '@/components/ui/Toast';

export type DailyPromptType =
  | 'daily_scan_prompt'
  | 'daily_canonicalization_prompt';

export interface DailyPromptEditorProps {
  promptType: DailyPromptType;
  initialCurrent?: string | null;
  initialDefault?: string;
}

const REQUIRED_PLACEHOLDERS: Record<DailyPromptType, readonly string[]> = {
  daily_scan_prompt: ['{coverage_window_start}', '{coverage_window_end}'],
  daily_canonicalization_prompt: [
    '{scanned_topics_json}',
    '{existing_canonicals_json}',
  ],
};

interface PromptsResponse {
  daily_scan_prompt: string | null;
  daily_canonicalization_prompt: string | null;
  defaults: {
    daily_scan_prompt: string;
    daily_canonicalization_prompt: string;
  };
}

/**
 * Admin-only editor for a daily-alert prompt template.
 */
export function DailyPromptEditor({
  promptType,
  initialCurrent,
  initialDefault,
}: DailyPromptEditorProps) {
  const { t } = useTranslation();
  const [currentText, setCurrentText] = useState<string>('');
  const [defaultText, setDefaultText] = useState<string>('');
  const [loading, setLoading] = useState(initialDefault === undefined);
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const title =
    promptType === 'daily_scan_prompt'
      ? t('adminDailyAlert.prompt.scanTitle')
      : t('adminDailyAlert.prompt.canonicalizationTitle');

  const requiredPlaceholders = REQUIRED_PLACEHOLDERS[promptType];
  const missingPlaceholders = requiredPlaceholders.filter(
    (p) => !currentText.includes(p)
  );
  const hasMissing = missingPlaceholders.length > 0;

  useEffect(() => {
    if (initialDefault !== undefined) {
      setDefaultText(initialDefault);
      setCurrentText(initialCurrent ?? initialDefault);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/admin/daily-alert-prompts', {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { data: PromptsResponse };
        if (cancelled) return;
        const def = body.data.defaults[promptType];
        const cur = body.data[promptType];
        setDefaultText(def);
        setCurrentText(cur ?? def);
      } catch (e) {
        if (!cancelled) {
          setToast({
            kind: 'error',
            text: e instanceof Error ? e.message : 'Failed to load',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [promptType, initialCurrent, initialDefault]);

  const handleSave = async () => {
    if (hasMissing) {
      setToast({
        kind: 'error',
        text: t('adminDailyAlert.prompt.validationMissingPlaceholders').replace(
          '{missing}',
          missingPlaceholders.join(', ')
        ),
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/daily-alert-prompts/${encodeURIComponent(promptType)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template_text: currentText }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      setToast({
        kind: 'success',
        text: t('adminDailyAlert.prompt.savedToast'),
      });
    } catch (e) {
      setToast({
        kind: 'error',
        text:
          e instanceof Error
            ? e.message
            : t('adminDailyAlert.prompt.errorToast'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetConfirmed = () => {
    setCurrentText(defaultText);
    setResetOpen(false);
  };

  if (loading) {
    return (
      <section className="space-y-3">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-foreground-muted">{t('common.loading')}</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setResetOpen(true)}
        >
          {t('adminDailyAlert.prompt.reset')}
        </Button>
      </div>

      <textarea
        value={currentText}
        onChange={(e) => setCurrentText(e.target.value)}
        rows={24}
        spellCheck={false}
        className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 font-mono text-sm text-foreground transition-colors placeholder:text-foreground-subtle focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      />

      <p className="text-xs text-foreground-muted">
        {t('adminDailyAlert.prompt.placeholdersHint')}{' '}
        {requiredPlaceholders.map((ph, i) => {
          const present = currentText.includes(ph);
          return (
            <span key={ph}>
              <code
                className={`rounded px-1 py-0.5 font-mono text-[11px] ${
                  present
                    ? 'bg-muted text-foreground'
                    : 'bg-danger-bg font-semibold text-danger-fg'
                }`}
              >
                {ph}
              </code>
              {i < requiredPlaceholders.length - 1 ? ' ' : ''}
            </span>
          );
        })}
      </p>

      {hasMissing && (
        <p className="text-xs text-danger-fg">
          {t('adminDailyAlert.prompt.validationMissingPlaceholders').replace(
            '{missing}',
            missingPlaceholders.join(', ')
          )}
        </p>
      )}

      <Button onClick={handleSave} disabled={saving || hasMissing}>
        {saving ? '...' : t('adminDailyAlert.prompt.save')}
      </Button>

      <ConfirmModal
        open={resetOpen}
        title={t('adminDailyAlert.prompt.resetConfirmTitle')}
        body={<p>{t('adminDailyAlert.prompt.resetConfirmBody')}</p>}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        onConfirm={handleResetConfirmed}
        onCancel={() => setResetOpen(false)}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </section>
  );
}
