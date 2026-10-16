-- Emergency undo for 102. NOT applied with the forward migration.
-- Restores the exact pre-102 definitions; DOES NOT change existing accounts.
-- WARNING: this reopens client admin signup and cross-role company creation.
-- For a permanent reversal, register these statements as a new migration.
-- The company client must also return to its previous company_user metadata.

BEGIN;

DROP TRIGGER guard_technician_account_role ON public.technician_profiles;
DROP FUNCTION public.guard_technician_account_role();

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.signup_company(p_company_name text, p_company_type text, p_location_country_code text, p_location_city_name text DEFAULT NULL::text, p_location_city_lat double precision DEFAULT NULL::double precision, p_location_city_lng double precision DEFAULT NULL::double precision, p_location_city_geoname_id bigint DEFAULT NULL::bigint)
 RETURNS uuid
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

  IF NOT EXISTS (
    SELECT 1 FROM location_countries WHERE code = p_location_country_code AND is_active
  ) THEN
    RAISE EXCEPTION 'Unknown or inactive country "%".', p_location_country_code;
  END IF;

  SELECT email INTO v_email FROM profiles WHERE id = v_uid;

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

COMMIT;
