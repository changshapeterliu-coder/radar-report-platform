import { Inngest } from 'inngest';

/**
 * Central Inngest client. Used by:
 *   - src/lib/inngest/functions/* (register functions)
 *   - src/app/api/inngest/route.ts (serve webhook handler)
 *   - API routes that enqueue events (e.g., manual trigger)
 *
 * The INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY env vars are auto-injected
 * in Vercel Production + Preview by the Vercel ↔ Inngest integration.
 * Inngest SDK picks them up from process.env automatically.
 */
export const inngest = new Inngest({ id: 'radar-report-platform' });
