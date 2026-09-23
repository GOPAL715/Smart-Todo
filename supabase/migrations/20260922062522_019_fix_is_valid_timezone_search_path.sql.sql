-- Fix security advisor finding: is_valid_timezone has mutable search_path
-- This function is referenced by a CHECK constraint on profiles.timezone,
-- so it must have a fixed search_path to prevent search_path injection.
CREATE OR REPLACE FUNCTION public.is_valid_timezone(p_tz text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
BEGIN
IF p_tz IS NULL OR p_tz = '' THEN
RETURN false;
END IF;
PERFORM now() AT TIME ZONE p_tz;
RETURN true;
EXCEPTION WHEN OTHERS THEN
RETURN false;
END;
$function$;
