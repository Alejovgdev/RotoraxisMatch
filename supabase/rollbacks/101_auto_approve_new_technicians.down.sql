-- Restore the signup behaviour from migrations 001 and 011.
-- Keep outside migrations/: do NOT apply together with migration 101.
-- No existing account or profile is updated or deactivated.
-- For a permanent reversal, register these definitions as a NEW forward
-- migration; leave 101 and its migration history intact.

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE((NEW.raw_user_meta_data->>'role')::app_role, 'technician')
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.force_technician_profile_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.verification_status := 'pending';
  RETURN NEW;
END;
$$;

COMMIT;
