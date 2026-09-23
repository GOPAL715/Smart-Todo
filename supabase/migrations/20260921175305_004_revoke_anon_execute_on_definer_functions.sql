/*
# Revoke anon execute on SECURITY DEFINER functions

## Overview
Fixes security advisor warnings by revoking EXECUTE from the anon role on
both SECURITY DEFINER functions.

## Changes
1. handle_new_user() — should only run via trigger, not callable directly.
   Revoke EXECUTE from anon and authenticated (trigger runs as definer).
2. process_due_reminders() — should only be callable by authenticated users.
   Revoke EXECUTE from anon, keep grant on authenticated.
*/

REVOKE EXECUTE ON FUNCTION handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION process_due_reminders() FROM anon;
