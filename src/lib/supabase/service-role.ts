import { createClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client that uses the service role key to BYPASS RLS.
 *
 * ONLY use this in:
 *   - Inngest functions (running on Inngest Cloud, no user session context)
 *   - Server-side background jobs
 *
 * NEVER:
 *   - Import into a client component
 *   - Expose the service role key via NEXT_PUBLIC_* env vars
 *   - Use in API routes that accept user input without explicit authz checks
 *
 * This client has full table read/write access and bypasses every RLS policy.
 *
 * Note: We intentionally do NOT pass the `Database` generic. The rest of the
 * codebase uses untyped Supabase clients (see `lib/supabase/server.ts`), and
 * mixing typed + untyped clients causes `insert()` overload resolution to
 * fail in unexpected ways with supabase-js v2. Cast the return types at call
 * sites where necessary.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  }
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set — add it to Vercel env vars (Production + Preview)'
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
