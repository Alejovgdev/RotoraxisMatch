-- Public signup accepts exactly technician/company. Company accounts retain
-- the existing internal company_user enum; no stored account is changed.
-- Existing admins remain intact. Provision future admins administratively
-- in Supabase, never through client-supplied signup metadata.
-- Undo (not installed): ../rollbacks/102_signup_role_guards.down.sql

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_requested_role text := NEW.raw_user_meta_data->>'role';
  v_role app_role;
BEGIN
  IF v_requested_role IS NULL OR v_requested_role NOT IN ('technician', 'company') THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Invalid signup role: expected technician or company.';
  END IF;
  v_role := CASE WHEN v_requested_role = 'technician'
    THEN 'technician'::app_role ELSE 'company_user'::app_role END;
  INSERT INTO public.profiles (id, email, role, status)
  VALUES (NEW.id, NEW.email, v_role,
    CASE WHEN v_role = 'technician'::app_role
      THEN 'active'::user_status ELSE 'pending_verification'::user_status END);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.signup_company(
  p_company_name             TEXT,
  p_company_type             TEXT,
  p_location_country_code    TEXT,
  p_location_city_name       TEXT             DEFAULT NULL,
  p_location_city_lat        DOUBLE PRECISION DEFAULT NULL,
  p_location_city_lng        DOUBLE PRECISION DEFAULT NULL,
  p_location_city_geoname_id BIGINT           DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
  v_cid   UUID;
  v_city  TEXT := NULLIF(btrim(COALESCE(p_location_city_name, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- profiles.role is authoritative. Auth metadata can be edited by its owner.
  SELECT email INTO v_email FROM public.profiles
  WHERE id = v_uid AND role = 'company_user';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Only company accounts can register a company.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM location_countries WHERE code = p_location_country_code AND is_active
  ) THEN
    RAISE EXCEPTION 'Unknown or inactive country "%".', p_location_country_code;
  END IF;

  INSERT INTO companies (
    name, company_type, email,
    location_country_code, location_city_name,
    location_city_lat, location_city_lng, location_city_geoname_id
  )
  VALUES (
    p_company_name, p_company_type, v_email,
    p_location_country_code, v_city,
    CASE WHEN v_city IS NULL THEN NULL ELSE p_location_city_lat END,
    CASE WHEN v_city IS NULL THEN NULL ELSE p_location_city_lng END,
    CASE WHEN v_city IS NULL OR p_location_city_lat IS NULL THEN NULL ELSE p_location_city_geoname_id END
  )
  RETURNING id INTO v_cid;

  INSERT INTO company_members (company_id, user_id, role)
  VALUES (v_cid, v_uid, 'admin');

  RETURN v_cid;
END;
$function$;

-- Enforce the same account/role rule in the reverse direction, including
-- direct INSERTs permitted by RLS. Keep the 101 verification trigger intact.
CREATE FUNCTION public.guard_technician_account_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.user_id AND role = 'technician') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Only technician accounts can register a technician profile.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_technician_account_role() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_technician_account_role
  BEFORE INSERT ON public.technician_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_technician_account_role();
