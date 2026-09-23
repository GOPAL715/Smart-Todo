/*
# Custom timezone selection per user

1. Purpose
   Each user can pick the IANA timezone the app should use to interpret their
   local task dates/times and recurrence boundaries. The database keeps storing
   every instant (start_datetime, end_datetime, reminder_time) as UTC
   timestamptz — nothing about the canonical timestamp strategy changes.

2. Schema change (additive only)
   - `profiles.timezone text NOT NULL DEFAULT 'Asia/Kolkata'`
     Existing rows are backfilled by the DEFAULT on ALTER; existing users keep
     working unchanged.
   - CHECK constraint `profiles_timezone_valid`:
       timezone IS NOT NULL AND public.is_valid_timezone(timezone)
     so an unrecognised string can never be stored.

3. New function `is_valid_timezone(text)`
   Returns true when Postgres recognises the value as a time zone (it performs
   `now() AT TIME ZONE tz` and reports failure), so arbitrary strings are not
   trusted. The shipped UI additionally restricts choices to IANA zone names.

4. Security
   - The column lives on `profiles`, which already has owner-scoped RLS
     (select/insert/update all keyed on auth.uid() = id), so a user can modify
     only their own timezone and anonymous users can modify nobody's. No new
     policy or grant is introduced.
   - `is_valid_timezone` is SECURITY INVOKER, STABLE, and reads no tables, so it
     cannot be used to bypass RLS.
   - Idempotent: IF NOT EXISTS, DROP CONSTRAINT IF EXISTS before create.
*/

CREATE OR REPLACE FUNCTION public.is_valid_timezone(p_tz text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF p_tz IS NULL OR p_tz = '' THEN
    RETURN false;
  END IF;
  PERFORM now() AT TIME ZONE p_tz;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kolkata';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_timezone_valid' AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_timezone_valid
      CHECK (public.is_valid_timezone(timezone));
  END IF;
END $$;
