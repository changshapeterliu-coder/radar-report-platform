-- ============================================================
-- 023_harden_handle_new_user.sql
-- Harden the on_auth_user_created trigger so it never blocks
-- auth.users INSERT, even if the profiles row insert misbehaves.
--
-- Why:
-- Sept-2026 incident: "Add User" in /admin/users (and Supabase
-- Dashboard's own Add User) returned 500 'unexpected_failure'.
-- Root suspect was the trigger throwing on the auth.users INSERT
-- transaction — possibly because of an unset search_path inside
-- a SECURITY DEFINER function (Postgres CVE-2018-1058 hardening
-- defaults), possibly something else. The original logs surfaced
-- nothing from inside the trigger.
--
-- This migration:
--  1. Pins search_path so SECURITY DEFINER resolves `profiles`
--     unambiguously regardless of who calls it.
--  2. Wraps the INSERT in BEGIN..EXCEPTION so trigger failures
--     downgrade to WARNING (visible in Postgres logs) instead of
--     aborting auth.users INSERT. User creation always succeeds;
--     a missing/incomplete profiles row can be reconciled later.
--  3. Switches to ON CONFLICT (id) DO UPDATE so re-runs and
--     edge cases (manual profile insert before trigger fires)
--     are idempotent.
--  4. Includes the email column — matches what the live function
--     was already doing in production (the original 002 migration
--     only inserted 3 columns; the prod function had drifted to
--     4). Codifying the drift is the point of this file.
--
-- Run this in the Supabase Dashboard SQL Editor (or via the
-- Supabase CLI when migrations are applied automatically).
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, email, role, language_preference)
    VALUES (NEW.id, NEW.email, 'team_member', 'zh')
    ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user failed for user %: % (SQLSTATE: %)',
        NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$function$;
