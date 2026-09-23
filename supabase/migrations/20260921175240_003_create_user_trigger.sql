/*
# Create handle_new_user trigger function

## Overview
Creates a trigger function that automatically creates a profile row when a new
user signs up via Supabase Auth. The profile is populated from the user's
metadata (name) and auth.users email.

## How it works
1. AFTER INSERT on auth.users
2. Inserts a row into profiles with id = new user's id, name from raw_user_meta_data,
   email from the new user's email.

## Security
- SECURITY DEFINER so the trigger can insert into profiles during signup.
- search_path set to public for safety.
*/

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.email, '')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
