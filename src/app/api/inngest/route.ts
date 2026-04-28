import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { functions } from '@/lib/inngest/functions';

/**
 * Inngest webhook handler.
 *
 * Inngest Cloud calls this endpoint via HTTPS to:
 *   - Trigger registered functions (scheduleTick by cron, generateReport by event)
 *   - Sync function definitions on every Vercel deploy (via the integration)
 *
 * The `serve()` helper validates signatures using INNGEST_SIGNING_KEY (auto-
 * injected by the Vercel integration) and routes requests to the correct
 * function. Failed signature validation → rejected at this layer before any
 * function code runs.
 */

/**
 * Per-invocation wall-clock cap (seconds).
 *
 * Each Inngest step = one HTTP POST to this route. Vercel terminates
 * any serverless function running beyond `maxDuration`.
 *
 * Pro plan allows up to 800s (~13 min). We use the ceiling so that the
 * heaviest step — Kimi/DeepSeek summarizer with ~40-80KB of deep-dive
 * JSON input — has enough headroom. Hobby (300s) was clipping Kimi
 * summarizer at exactly 5:00 with FUNCTION_INVOCATION_TIMEOUT.
 */
export const maxDuration = 800;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
