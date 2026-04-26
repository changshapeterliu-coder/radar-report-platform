import { scheduleTick } from './schedule-tick';
import { generateReport } from './generate-report';

export { scheduleTick, generateReport };

/**
 * Aggregate array consumed by `src/app/api/inngest/route.ts` via `serve()`.
 * Add new Inngest functions to this list so Vercel's webhook registers them.
 */
export const functions = [scheduleTick, generateReport];
