-- ============================================================
-- AviationJobTalent V2 — Migration 086: una oferta FAA puede nombrar aeronaves
-- ============================================================
-- Created: 2026-09-18 (Fase 10, sesión 2, punto 1)
--
-- Hasta aquí una oferta que certificaba bajo la FAA no podía pedir aeronaves:
-- la FAA no emite type ratings (`authorities.has_type_ratings = false`), así
-- que no había habilitación contra la que cruzarlas. Desde la sesión 2 esas
-- aeronaves son EXPERIENCIA: el scorer las compara con
-- `technician_aircraft_experience` y puntúan sin excluir a nadie
-- (offerMatchExplain.ts, `aircraftEvidenceFor`).
--
-- En la base la prohibición vivía en UN sitio: la RPC de la 082,
-- `update_offer_with_habilitations`, vaciaba las aeronaves en silencio cuando
-- el patch dejaba la oferta certificando bajo la FAA y no traía lista nueva.
-- Ningún CHECK ni trigger lo imponía (verificado el 2026-09-18: los triggers de
-- offer_required_habilitations sólo miran offer_kind = 'engine').
--
-- Esta migración reemplaza la función con el MISMO cuerpo que la 082 (la
-- versión viva coincide byte a byte con el fichero, comprobado antes de
-- escribir esto) salvo esa cláusula. Lo demás no cambia: cambiar de producto o
-- pasar a motor sigue limpiando las aeronaves, y una oferta de motor sigue sin
-- poder tenerlas (076).
--
-- Datos: no hay ofertas FAA (0 filas con license_authority = 'FAA'), así que
-- no hay nada que mover.
-- ============================================================

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

-- CREATE OR REPLACE conserva los permisos; se repiten los de la 082 para que
-- la migración diga ella sola quién puede llamarla.
REVOKE ALL ON FUNCTION public.update_offer_with_habilitations(uuid,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_offer_with_habilitations(uuid,jsonb,jsonb) TO authenticated;


-- ── Post-condiciones ───────────────────────────────────────

DO $$
DECLARE v_def TEXT; v_invoker BOOLEAN;
BEGIN
  SELECT pg_get_functiondef(p.oid), NOT p.prosecdef INTO v_def, v_invoker
    FROM pg_proc p WHERE p.oid = 'public.update_offer_with_habilitations(uuid,jsonb,jsonb)'::regprocedure;
  IF position('''FAA''' IN v_def) > 0 THEN
    RAISE EXCEPTION '086: update_offer_with_habilitations sigue mencionando la FAA.';
  END IF;
  IF NOT v_invoker THEN
    RAISE EXCEPTION '086: update_offer_with_habilitations debe seguir siendo SECURITY INVOKER.';
  END IF;
  IF has_function_privilege('anon', 'public.update_offer_with_habilitations(uuid,jsonb,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.update_offer_with_habilitations(uuid,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '086: permisos de update_offer_with_habilitations distintos de los de la 082.';
  END IF;
  RAISE NOTICE '086: update_offer_with_habilitations ya no vacía las aeronaves de una oferta FAA.';
END $$;

NOTIFY pgrst, 'reload schema';
