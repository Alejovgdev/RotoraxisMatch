-- New technician accounts enter the platform without admin approval.
-- Only INSERT defaults change: existing accounts, company signup, manual
-- moderation, RLS and protected-field UPDATE guards are left intact.
-- Undo: supabase/rollbacks/101_auto_approve_new_technicians.down.sql

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role app_role := COALESCE((NEW.raw_user_meta_data->>'role')::app_role, 'technician');
BEGIN
  INSERT INTO public.profiles (id, email, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    v_role,
    CASE WHEN v_role = 'technician'::app_role
      THEN 'active'::user_status
      ELSE 'pending_verification'::user_status
    END
  );
  RETURN NEW;
END;
$$;

-- Replace the function used by the INSERT trigger from migration 011.
-- The value is still decided by the server, regardless of client input.
CREATE OR REPLACE FUNCTION public.force_technician_profile_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.verification_status := CASE WHEN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.user_id AND role = 'technician' AND status = 'active'
  ) THEN 'verified'::verification_status ELSE 'pending'::verification_status END;
  -- Checking account status also preserves older pending signups whose
  -- technician profile is only created when they later confirm their email.
  RETURN NEW;
END;
$$;
