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
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
