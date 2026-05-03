/**
 * Admin authz helper for all /api/admin/daily-alert-* routes.
 *
 * Matches the existing weekly-pipeline admin-endpoint pattern:
 *   - cookie-based SSR Supabase client
 *   - `auth.getUser()` must return a user (else 401)
 *   - the user's profile.role must be 'admin' (else 403)
 *
 * Route handlers should use this as:
 *
 *     const gate = await requireAdmin();
 *     if (!gate.ok) {
 *       return NextResponse.json({ error: gate.error }, { status: gate.status });
 *     }
 *     // proceed with admin-gated logic
 *
 * Spec refs:
 *   Requirements: 1.7, 3.5, 11.6, 12.8
 *   Design:       §API 路由 §共享 admin 鉴权 helper
 * Property refs (PBT):
 *   P45 — Auth on /api/admin/daily-alert-configs
 *   P46 — Auth on /api/admin/daily-alert-runs/trigger
 *   P47 — Auth on /api/admin/daily-alert-prompts
 */

import { createClient as createSupabaseServerClient } from '@/lib/supabase/server';

export type RequireAdminResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Verify the current cookie-session user has `role='admin'`. Returns the
 * user id on success or a typed error payload on failure.
 *
 * Uses `.limit(1).maybeSingle()` over `.single()` (per tech-environment-
 * compatibility rule) to avoid the .single() "0 or >1 rows throw" pitfall
 * for users who somehow lack a profiles row.
 */
export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, status: 401, error: 'Not authenticated' };
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .limit(1)
    .maybeSingle();

  if (error) {
    // Treat profile-fetch errors as 403 (safer than 500; do not expose
    // DB error details to unauthenticated callers).
    return { ok: false, status: 403, error: 'Admin access required' };
  }

  if (profile?.role !== 'admin') {
    return { ok: false, status: 403, error: 'Admin access required' };
  }

  return { ok: true, userId: user.id };
}
