-- H1: one RPC is one transaction. Validate the whole payload before deleting;
-- FK/trigger failures during the final write also roll back the replacement.
-- INVOKER preserves existing RLS. Parent row locks serialize replacements.
CREATE OR REPLACE FUNCTION public.replace_technician_habilitations(p_technician_id uuid, p_entries jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
DECLARE entry record; license_id uuid; rows_to_write jsonb := '[]'; seen text[] := '{}'; key text;
BEGIN
  IF NOT public.is_active_user() OR p_technician_id IS DISTINCT FROM public.my_technician_id() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized.';
  END IF;
  PERFORM 1 FROM public.technician_profiles WHERE id=p_technician_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries)<>'array' THEN RAISE EXCEPTION 'Expected a ratings array'; END IF;
  FOR entry IN SELECT * FROM jsonb_to_recordset(p_entries) AS x(authority text, license_code text,
    aircraft_type_rating_id uuid, issued_at date, expires_at date, experience_years numeric, is_current boolean)
  LOOP
    SELECT id INTO license_id FROM public.technician_licenses
      WHERE technician_id=p_technician_id AND authority=entry.authority AND license_code=entry.license_code FOR SHARE;
    IF license_id IS NULL THEN RAISE EXCEPTION 'Cannot save type rating: the credential is missing'; END IF;
    PERFORM 1 FROM public.aircraft_type_ratings WHERE id=entry.aircraft_type_rating_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown aircraft type rating'; END IF;
    IF entry.experience_years IS NOT NULL AND (entry.experience_years<0 OR entry.experience_years>70 OR entry.experience_years='NaN'::numeric) THEN
      RAISE EXCEPTION 'Experience years must be between 0 and 70';
    END IF;
    key:=license_id::text || '/' || entry.aircraft_type_rating_id::text;
    IF key=ANY(seen) THEN RAISE EXCEPTION 'Duplicate type rating for this credential'; END IF;
    seen:=array_append(seen,key);
    rows_to_write:=rows_to_write || jsonb_build_array(to_jsonb(entry) || jsonb_build_object('technician_license_id',license_id));
  END LOOP;
  DELETE FROM public.technician_habilitations WHERE technician_id=p_technician_id;
  INSERT INTO public.technician_habilitations(technician_id,technician_license_id,license_code,aircraft_type_rating_id,issued_at,expires_at,experience_years,is_current)
    SELECT p_technician_id,x.technician_license_id,x.license_code,x.aircraft_type_rating_id,x.issued_at,x.expires_at,x.experience_years,coalesce(x.is_current,true)
    FROM jsonb_to_recordset(rows_to_write) AS x(technician_license_id uuid,license_code text,aircraft_type_rating_id uuid,issued_at date,expires_at date,experience_years numeric,is_current boolean);
END $$;

CREATE OR REPLACE FUNCTION public.replace_technician_engines(p_technician_id uuid, p_entries jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
DECLARE entry record; seen uuid[] := '{}';
BEGIN
  IF NOT public.is_active_user() OR p_technician_id IS DISTINCT FROM public.my_technician_id() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized.';
  END IF;
  PERFORM 1 FROM public.technician_profiles WHERE id=p_technician_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries)<>'array' THEN RAISE EXCEPTION 'Expected an engines array'; END IF;
  FOR entry IN SELECT * FROM jsonb_to_recordset(p_entries) AS x(engine_id uuid,years numeric) LOOP
    PERFORM 1 FROM public.engines WHERE id=entry.engine_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown engine'; END IF;
    IF entry.years IS NOT NULL AND (entry.years<0 OR entry.years>70 OR entry.years='NaN'::numeric) THEN
      RAISE EXCEPTION 'Engine years must be between 0 and 70';
    END IF;
    IF entry.engine_id=ANY(seen) THEN RAISE EXCEPTION 'Duplicate engine'; END IF;
    seen:=array_append(seen,entry.engine_id);
  END LOOP;
  DELETE FROM public.technician_engine_experience WHERE technician_id=p_technician_id;
  INSERT INTO public.technician_engine_experience(technician_id,engine_id,years)
    SELECT p_technician_id,x.engine_id,x.years FROM jsonb_to_recordset(p_entries) AS x(engine_id uuid,years numeric);
END $$;

-- NULL ratings means keep them, except when changing product or losing the
-- ability to require aircraft. [] explicitly clears them. Both the edited
-- offer and its replacement aircraft set commit together.
CREATE OR REPLACE FUNCTION public.update_offer_with_habilitations(p_offer_id uuid, p_patch jsonb, p_habilitations jsonb DEFAULT NULL)
RETURNS public.offers LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
DECLARE old_offer public.offers; next_offer public.offers; entry record; check_row record;
  valid boolean; assignments text; null_keys text; equal_keys text;
  replacement jsonb:=p_habilitations; seen uuid[]:='{}';
BEGIN
  SELECT * INTO old_offer FROM public.offers WHERE id=p_offer_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_active_user() OR
     NOT (public.is_admin() OR public.can_act_for_company(old_offer.company_id)) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized.';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' THEN RAISE EXCEPTION 'Expected an offer patch'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) AS k(key) WHERE key<>ALL(ARRAY[
    'title','description','contract_type','salary_amount','salary_currency','salary_period','product_type','technician_type',
    'requires_certification','license_code','license_authority','accepts_equivalent','only_unlicensed','requires_all_aircraft',
    'offer_kind','required_engine_id','location_country','location_country_code','location_city_name','location_city_lat',
    'location_city_lng','location_city_geoname_id','min_years_experience','status','visible','expires_at'])) THEN
    RAISE EXCEPTION 'Unsupported offer field';
  END IF;
  next_offer:=jsonb_populate_record(old_offer,p_patch);
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.offers'::regclass AND attnum>0
    AND attnotnull AND NOT attisdropped AND (to_jsonb(next_offer)->attname)='null'::jsonb) THEN
    RAISE EXCEPTION 'Missing required offer field' USING ERRCODE='23502';
  END IF;
  -- Validate existing CHECKs against the candidate without mutating a row.
  -- This includes shape, salary, years, licence/authority and location rules.
  FOR check_row IN SELECT conname,pg_get_expr(conbin,conrelid) AS expression FROM pg_constraint
    WHERE conrelid='public.offers'::regclass AND contype='c'
  LOOP
    EXECUTE format('SELECT (%s) IS NOT FALSE FROM jsonb_populate_record(NULL::public.offers,$1)',check_row.expression)
      INTO valid USING to_jsonb(next_offer);
    IF NOT valid THEN RAISE EXCEPTION 'Invalid offer: %',check_row.conname USING ERRCODE='23514'; END IF;
  END LOOP;
  -- Check every FK, including composite licence/authority pairs, before delete.
  FOR check_row IN SELECT * FROM pg_constraint WHERE conrelid='public.offers'::regclass AND contype='f' LOOP
    SELECT string_agg(format('candidate.%I IS NULL',a.attname),' OR '),
      string_agg(format('candidate.%I=referenced.%I',a.attname,b.attname),' AND ')
      INTO null_keys,equal_keys
      FROM unnest(check_row.conkey,check_row.confkey) AS k(local_key,foreign_key)
      JOIN pg_attribute a ON a.attrelid=check_row.conrelid AND a.attnum=k.local_key
      JOIN pg_attribute b ON b.attrelid=check_row.confrelid AND b.attnum=k.foreign_key;
    EXECUTE format('SELECT (%s) OR EXISTS(SELECT 1 FROM %s referenced WHERE %s) FROM jsonb_populate_record(NULL::public.offers,$1) candidate',
      null_keys,check_row.confrelid::regclass,equal_keys) INTO valid USING to_jsonb(next_offer);
    IF NOT valid THEN RAISE EXCEPTION 'Invalid offer reference: %',check_row.conname USING ERRCODE='23503'; END IF;
  END LOOP;
  IF replacement IS NULL AND (old_offer.product_type IS DISTINCT FROM next_offer.product_type OR next_offer.offer_kind='engine'
    OR (next_offer.requires_certification AND next_offer.license_authority='FAA')) THEN replacement:='[]'; END IF;
  IF replacement IS NOT NULL THEN
    IF jsonb_typeof(replacement)<>'array' THEN RAISE EXCEPTION 'Expected an aircraft array'; END IF;
    FOR entry IN SELECT * FROM jsonb_to_recordset(replacement) AS x(aircraft_type_rating_id uuid,notes text) LOOP
      PERFORM 1 FROM public.aircraft_type_ratings WHERE id=entry.aircraft_type_rating_id AND product_type=next_offer.product_type;
      IF NOT FOUND THEN RAISE EXCEPTION 'Aircraft type rating does not match offer product'; END IF;
      IF entry.aircraft_type_rating_id=ANY(seen) THEN RAISE EXCEPTION 'Duplicate aircraft type rating'; END IF;
      seen:=array_append(seen,entry.aircraft_type_rating_id);
    END LOOP;
    IF jsonb_array_length(replacement)>0 AND next_offer.offer_kind='engine' THEN RAISE EXCEPTION 'Engine offers cannot require aircraft'; END IF;
    DELETE FROM public.offer_required_habilitations WHERE offer_id=p_offer_id;
  END IF;
  SELECT string_agg(format('%I=next.%I',key,key),',') INTO assignments FROM jsonb_object_keys(p_patch) AS k(key);
  IF assignments IS NOT NULL THEN
    EXECUTE format('UPDATE public.offers SET %s FROM jsonb_populate_record(NULL::public.offers,$1) AS next WHERE offers.id=$2 RETURNING offers.*',assignments)
      INTO next_offer USING to_jsonb(next_offer),p_offer_id;
    IF next_offer.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Not authorized.'; END IF;
  END IF;
  IF replacement IS NOT NULL THEN
    INSERT INTO public.offer_required_habilitations(offer_id,product_type,aircraft_type_rating_id,notes)
      SELECT p_offer_id,next_offer.product_type,x.aircraft_type_rating_id,x.notes
      FROM jsonb_to_recordset(replacement) AS x(aircraft_type_rating_id uuid,notes text);
  END IF;
  RETURN next_offer;
END $$;

REVOKE ALL ON FUNCTION public.replace_technician_habilitations(uuid,jsonb), public.replace_technician_engines(uuid,jsonb), public.update_offer_with_habilitations(uuid,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_technician_habilitations(uuid,jsonb), public.replace_technician_engines(uuid,jsonb), public.update_offer_with_habilitations(uuid,jsonb,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
