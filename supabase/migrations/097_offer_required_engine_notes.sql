-- 097: nota opcional del motor de una oferta. Sólo informativa; no puntúa.
-- Aplicar UNA vez, después de 096, por el endpoint de migraciones y con OK.
-- Ensayo: node scripts/rehearseOfferEngineNotes.cjs (todo termina en ROLLBACK).
-- Expand-contract: aplicar antes de que el cliente seleccione/escriba la columna.
-- Sin backfill: las ofertas existentes conservan todos sus valores y nota NULL.

ALTER TABLE public.offers ADD COLUMN required_engine_notes text;

COMMENT ON COLUMN public.offers.required_engine_notes IS
  'Optional informational note for required_engine_id. Display only; never used for matching.';

ALTER TABLE public.offers ADD CONSTRAINT chk_offers_engine_notes
  CHECK (required_engine_notes IS NULL OR offer_kind = 'engine');

-- Misma RPC y permisos que 096; sólo ampliamos el patch y limpiamos la nota
-- omitida cuando su motor ya no existe en el estado resultante.
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
  -- 088: 'accepted_authorities' entra; 'accepts_equivalent' se queda mientras dure la ventana.
  -- 096: 'accepted_license_code' entra; 097: 'required_engine_notes' entra.
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) AS k(key) WHERE key<>ALL(ARRAY[
    'title','description','contract_type','salary_amount','salary_currency','salary_period','product_type','technician_type',
    'requires_certification','license_code','license_authority','accepts_equivalent','accepted_authorities','accepted_license_code','only_unlicensed','requires_all_aircraft',
    'offer_kind','required_engine_id','required_engine_notes','location_country','location_country_code','location_city_name','location_city_lat',
    'location_city_lng','location_city_geoname_id','min_years_experience','status','visible','expires_at'])) THEN
    RAISE EXCEPTION 'Unsupported offer field';
  END IF;
  next_offer:=jsonb_populate_record(old_offer,p_patch);
  -- 097: una nota omitida se conserva al editar otros campos. Un cliente
  -- anterior a 097 no conoce la nota: si cambia de motor o pasa a aeronave,
  -- retirar la nota anterior en el mismo UPDATE. Una nota explícita se valida.
  IF NOT (p_patch ? 'required_engine_notes')
     AND (next_offer.offer_kind <> 'engine'
          OR old_offer.required_engine_id IS DISTINCT FROM next_offer.required_engine_id) THEN
    p_patch:=p_patch || '{"required_engine_notes":null}'::jsonb;
    next_offer.required_engine_notes:=NULL;
  END IF;
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
  -- 086: sin la cláusula FAA. Bajo la FAA las aeronaves son experiencia.
  IF replacement IS NULL AND (old_offer.product_type IS DISTINCT FROM next_offer.product_type OR next_offer.offer_kind='engine') THEN
    replacement:='[]';
  END IF;
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

REVOKE ALL ON FUNCTION public.update_offer_with_habilitations(uuid,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_offer_with_habilitations(uuid,jsonb,jsonb) TO authenticated;



-- Postcondiciones sin escribir datos de usuarios.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='offers'
      AND column_name='required_engine_notes' AND data_type='text'
      AND is_nullable='YES' AND column_default IS NULL
  ) THEN RAISE EXCEPTION '097: expected optional text without default'; END IF;
  IF EXISTS (SELECT 1 FROM public.offers WHERE required_engine_notes IS NOT NULL) THEN
    RAISE EXCEPTION '097: existing offers must start without an engine note';
  END IF;
  IF NOT has_function_privilege('authenticated','public.update_offer_with_habilitations(uuid,jsonb,jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.update_offer_with_habilitations(uuid,jsonb,jsonb)','EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid='public.update_offer_with_habilitations(uuid,jsonb,jsonb)'::regprocedure) THEN
    RAISE EXCEPTION '097: unexpected RPC permissions';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
