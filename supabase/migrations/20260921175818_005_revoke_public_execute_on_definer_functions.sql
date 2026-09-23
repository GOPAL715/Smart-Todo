/*
# Revoke PUBLIC execute on SECURITY DEFINER functions

## Overview
The Supabase linter still warns that anon/authenticated can execute our
SECURITY DEFINER functions via PostgREST. This is because PostgreSQL grants
EXECUTE on functions to PUBLIC by default. REVOKE EXECUTE FROM PUBLIC removes
that broad grant, then we re-grant only to the roles that need it.

## Changes
1. handle_new_user() — trigger-only function. Revoke from PUBLIC.
   No re-grant needed (triggers run as the function's definer).
2. process_due_reminders() — Revoke from PUBLIC, re-grant to authenticated only.
*/

REVOKE EXECUTE ON FUNCTION handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION process_due_reminders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_due_reminders() TO authenticated;
