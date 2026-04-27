import type { EngineError } from '@/types/scheduled-runs';

/**
 * Decides the final `scheduled_runs.status` from the three component outcomes.
 *
 * Status table (design "Scheduled_Run 状态决策表"):
 *   (false, false, _)  → 'failed'              (both engines down, synth not invoked)
 *   (≥1 engine ok) & synthOk=true  → 'succeeded'
 *   (≥1 engine ok) & synthOk=false → 'partial'
 */
export function determineStatus(
  geminiLoopOk: boolean,
  kimiLoopOk: boolean,
  synthesizerOk: boolean
): 'succeeded' | 'partial' | 'failed' {
  if (!geminiLoopOk && !kimiLoopOk) return 'failed';
  return synthesizerOk ? 'succeeded' : 'partial';
}

/**
 * Assembles the human-readable `failure_reason` string from engine + synth
 * errors. Returns null if no errors occurred.
 *
 * Rules (design "错误处理" section):
 *   - If any error has errorClass === 'CreditsExhausted', start with the
 *     literal "OpenRouter credits exhausted" (the outer summary matters more
 *     than which engine first hit it)
 *   - Then group errors by engine (gemini/kimi/synthesizer) and for each
 *     non-credit-exhausted error append "{Engine}: {ErrorClass}" with a
 *     "(stage: {stage}[ subq #{n}])" suffix when present
 *   - Join segments with '; '
 */
export function buildFailureReason(errors: EngineError[]): string | null {
  if (errors.length === 0) return null;

  const segments: string[] = [];

  if (errors.some((e) => e.errorClass === 'CreditsExhausted')) {
    segments.push('OpenRouter credits exhausted');
  }

  const engineOrder: Array<EngineError['engine']> = ['gemini', 'kimi', 'synthesizer'];
  for (const engine of engineOrder) {
    const engineErrors = errors.filter(
      (e) => e.engine === engine && e.errorClass !== 'CreditsExhausted'
    );
    for (const err of engineErrors) {
      const label = engine.charAt(0).toUpperCase() + engine.slice(1);
      let segment = `${label}: ${err.errorClass}`;
      if (typeof err.httpStatus === 'number') {
        segment += ` [${err.httpStatus}]`;
      }
      if (err.stage) {
        const subqSuffix =
          typeof err.subquestionIndex === 'number'
            ? ` subq #${err.subquestionIndex}`
            : '';
        segment += ` (stage: ${err.stage}${subqSuffix})`;
      }
      if (err.message) {
        const snippet = err.message.length > 160 ? `${err.message.slice(0, 160)}…` : err.message;
        segment += ` — ${snippet}`;
      }
      segments.push(segment);
    }
  }

  return segments.length > 0 ? segments.join('; ') : null;
}
