-- ============================================================
-- AviationJobTalent V2 — Migration 088: equivalencias por autoridad
-- ============================================================
-- Created: 2026-09-18 (Fase 10, sesión 2, punto 3)
--
-- `offers.accepts_equivalent` (070) era un booleano: "acepto la misma
-- categoría de cualquier otra autoridad Part-66". La empresa no podía decir
-- "EASA, y también UK CAA, pero no GCAA". Esta migración lo sustituye por una
-- LISTA de autoridades aceptadas además de la exigida:
--
--   accepted_authorities TEXT[] NOT NULL DEFAULT '{}'
--     Vacía = sólo la autoridad exacta. Nunca contiene la exigida ni la FAA,
--     sólo autoridades Part-66 que emiten ESE código, y sólo si hay licencia.
--
-- La puntuación no cambia: exacta 100, equivalente aceptada 87 (el mismo
-- EQUIVALENT_AUTHORITY_DEGRADATION_FRACTION de siempre). Sólo cambia QUIÉN
-- cuenta como equivalente.
--
-- ── Backfill ────────────────────────────────────────────────────────────
-- Las ofertas con accepts_equivalent = true pasan a TODAS las otras
-- autoridades Part-66 que emiten su código (lo que la casilla significaba); el
-- resto, lista vacía (el DEFAULT). Hoy son 0 filas con la casilla marcada
-- (verificado el 2026-09-18), pero el UPDATE se escribe igual.
--
-- ── Dónde vive cada regla ───────────────────────────────────────────────
--   CHECK chk_offers_accepted_authorities: lo que se lee de la propia fila —
--     sólo autoridades Part-66, nunca la exigida, lista vacía sin licencia o
--     con una licencia FAA.
--   Trigger enforce_offer_accepted_authorities: lo que exige leer el catálogo
--     —cada autoridad aceptada emite ese código (authority_licenses)— y que no
--     haya repetidas. Un CHECK no puede consultar otra tabla, y copiar aquí los
--     recortes de CASA y GCAA sería la segunda fuente de verdad que la 066
--     evita. Rechaza, no corrige: limpiar las que ya no aplican al cambiar la
--     autoridad exigida lo hacen el formulario y el repositorio
--     (resolveOfferPatch), que es donde se sabe que ha cambiado.
--
-- ── accepts_equivalent ──────────────────────────────────────────────────
-- NO se borra (expand-contract): el código deja de leerla y escribirla en este
-- mismo punto, y la columna se retira en una migración posterior, cuando ese
-- código esté desplegado. La RPC sigue aceptándola como clave para no romper
-- un cliente anterior durante la ventana.
--
-- ── update_offer_with_habilitations ─────────────────────────────────────
-- Mismo cuerpo que la 086 más la clave 'accepted_authorities' en la lista de
-- campos admitidos. Sin ella la RPC rechaza con 'Unsupported offer field' toda
-- edición que toque la licencia. Los CHECK los valida ya sola (los lee de
-- pg_constraint); el trigger salta en su UPDATE, dentro de la misma
-- transacción, así que un rechazo también deshace el reemplazo de aeronaves.
-- ============================================================


-- ── 1. Columna y backfill ───────────────────────────────────

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS accepted_authorities TEXT[] NOT NULL DEFAULT '{}';

UPDATE public.offers o
   SET accepted_authorities = COALESCE((
         SELECT array_agg(al.authority ORDER BY a.sort_order)
           FROM public.authority_licenses al
           JOIN public.authorities a ON a.code = al.authority
          WHERE al.license_code = o.license_code
            AND al.authority <> o.license_authority
            AND al.authority IN ('EASA', 'UK_CAA', 'CASA', 'GCAA')
       ), '{}')
 WHERE o.accepts_equivalent
   AND o.license_code IS NOT NULL
   AND o.license_authority IN ('EASA', 'UK_CAA', 'CASA', 'GCAA');

COMMENT ON COLUMN public.offers.accepted_authorities IS
  'Fase 10 (088): autoridades Part-66 aceptadas ADEMÁS de license_authority para el mismo código. '
  'Vacía = sólo la exacta. Sustituye a accepts_equivalent.';
COMMENT ON COLUMN public.offers.accepts_equivalent IS
  'OBSOLETA desde la 088: ningún código la lee ni la escribe; la sustituye accepted_authorities. Retirada pendiente.';


-- ── 2. CHECK: lo que se lee de la fila ──────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.offers'::regclass
                   AND conname = 'chk_offers_accepted_authorities') THEN
    ALTER TABLE public.offers
      ADD CONSTRAINT chk_offers_accepted_authorities
      CHECK (
        accepted_authorities <@ ARRAY['EASA', 'UK_CAA', 'CASA', 'GCAA']::TEXT[]
        AND (
          cardinality(accepted_authorities) = 0
          OR (license_code IS NOT NULL
              AND license_authority IN ('EASA', 'UK_CAA', 'CASA', 'GCAA')
              AND NOT (license_authority = ANY (accepted_authorities)))
        )
      );
  END IF;
END $$;

COMMENT ON CONSTRAINT chk_offers_accepted_authorities ON public.offers IS
  'Fase 10 (088): sólo autoridades Part-66, nunca la exigida, y lista vacía sin licencia o con licencia FAA. '
  'Que cada una emita el código lo vigila el trigger enforce_offer_accepted_authorities.';


-- ── 3. Trigger: catálogo y repetidas ────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_offer_accepted_authorities()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_missing TEXT;
BEGIN
  -- Los triggers BEFORE corren ANTES que los CHECK. Lo que es forma de la fila
  -- (sin licencia, licencia FAA, una autoridad que no es Part-66) se deja al
  -- CHECK, que lo dice con su nombre; aquí sólo lo que necesita el catálogo.
  IF cardinality(NEW.accepted_authorities) = 0
     OR NEW.license_code IS NULL
     OR NEW.license_authority NOT IN ('EASA', 'UK_CAA', 'CASA', 'GCAA') THEN
    RETURN NEW;
  END IF;

  IF cardinality(NEW.accepted_authorities) <> (SELECT count(DISTINCT a) FROM unnest(NEW.accepted_authorities) AS a) THEN
    RAISE EXCEPTION 'Offer % lists an accepted authority twice.', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(a, ', ') INTO v_missing
    FROM unnest(NEW.accepted_authorities) AS a
   WHERE a IN ('EASA', 'UK_CAA', 'CASA', 'GCAA')
     AND NOT EXISTS (SELECT 1 FROM public.authority_licenses al
                      WHERE al.authority = a AND al.license_code = NEW.license_code);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '% does not issue a % licence, so offer % cannot accept it as equivalent.', v_missing, NEW.license_code, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_offer_accepted_authorities ON public.offers;
CREATE TRIGGER enforce_offer_accepted_authorities
  BEFORE INSERT OR UPDATE OF accepted_authorities, license_code, license_authority ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_offer_accepted_authorities();


-- ── 4. La RPC de edición admite la columna nueva ────────────

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
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) AS k(key) WHERE key<>ALL(ARRAY[
    'title','description','contract_type','salary_amount','salary_currency','salary_period','product_type','technician_type',
    'requires_certification','license_code','license_authority','accepts_equivalent','accepted_authorities','only_unlicensed','requires_all_aircraft',
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

REVOKE ALL ON FUNCTION public.update_offer_with_habilitations(uuid,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_offer_with_habilitations(uuid,jsonb,jsonb) TO authenticated;


-- ── Post-condiciones y autocomprobación ─────────────────────
--
-- Filas prohibidas en subtransacciones (tienen que rechazarlas ESTE CHECK o
-- ESTE trigger) y una permitida de control que se deshace. Nada queda escrito.

DO $$
DECLARE
  v_src        public.offers%ROWTYPE;
  v_case       RECORD;
  v_constraint TEXT;
  v_message    TEXT;
  v_ok         BOOLEAN;
  v_bad        INT;
BEGIN
  SELECT count(*) INTO v_bad FROM public.offers
   WHERE accepts_equivalent AND license_authority IN ('EASA', 'UK_CAA', 'CASA', 'GCAA') AND cardinality(accepted_authorities) = 0;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '088: % ofertas con la casilla marcada quedaron sin autoridades aceptadas.', v_bad;
  END IF;
  IF EXISTS (SELECT 1 FROM public.offers WHERE NOT accepts_equivalent AND cardinality(accepted_authorities) > 0) THEN
    RAISE EXCEPTION '088: una oferta sin la casilla quedó con autoridades aceptadas.';
  END IF;
  IF position('accepted_authorities' IN pg_get_functiondef('public.update_offer_with_habilitations(uuid,jsonb,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '088: la RPC no admite accepted_authorities.';
  END IF;

  SELECT * INTO v_src FROM public.offers LIMIT 1;
  IF v_src.id IS NULL THEN
    RAISE NOTICE '088: sin ofertas de las que copiar; autocomprobación omitida.';
    RETURN;
  END IF;

  FOR v_case IN SELECT * FROM (VALUES
      -- autoridad, código, aceptadas, lo que debe rechazarla
      ('EASA', 'B1.1', ARRAY['FAA'],              'chk_offers_accepted_authorities'),
      ('EASA', 'B1.1', ARRAY['EASA'],             'chk_offers_accepted_authorities'),
      ('FAA',  'A&P',  ARRAY['EASA'],             'chk_offers_accepted_authorities'),
      (NULL,   NULL,   ARRAY['UK_CAA'],           'chk_offers_accepted_authorities'),
      ('EASA', 'B2L',  ARRAY['CASA'],             'trigger'),
      ('EASA', 'B1.1', ARRAY['UK_CAA', 'UK_CAA'], 'trigger')
    ) AS t(authority, code, accepted, expected)
  LOOP
    v_constraint := NULL; v_message := NULL;
    BEGIN
      INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
        requires_certification, license_code, license_authority, accepted_authorities, location_country,
        location_country_code, min_years_experience, status, visible, offer_kind)
      VALUES (v_src.company_id, 'selftest-088', 'selftest', v_src.contract_type, 'Aeroplane',
        CASE WHEN v_case.code = 'B2L' THEN 'avionic' ELSE 'mechanic' END,
        v_case.code IS NOT NULL, v_case.code, v_case.authority, v_case.accepted, v_src.location_country,
        v_src.location_country_code, 0, 'draft', false, 'aircraft');
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME, v_message = MESSAGE_TEXT;
    END;
    IF v_case.expected = 'trigger' THEN
      -- Un RAISE de trigger no lleva constraint: se reconoce por su mensaje.
      IF v_message IS NULL OR COALESCE(v_constraint, '') <> ''
         OR NOT (v_message LIKE '%lists an accepted authority twice%' OR v_message LIKE '%does not issue%') THEN
        RAISE EXCEPTION '088: % % aceptando % no lo rechazó el trigger (constraint: %, mensaje: %).',
          v_case.authority, v_case.code, v_case.accepted, v_constraint, v_message;
      END IF;
    ELSIF v_constraint IS DISTINCT FROM v_case.expected THEN
      RAISE EXCEPTION '088: % % aceptando % no lo rechazó % (constraint: %).',
        v_case.authority, v_case.code, v_case.accepted, v_case.expected, v_constraint;
    END IF;
  END LOOP;

  -- Control: EASA B1.1 aceptando UK CAA y CASA es válida. Se escribe y se deshace.
  v_ok := false;
  BEGIN
    INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
      requires_certification, license_code, license_authority, accepted_authorities, location_country,
      location_country_code, min_years_experience, status, visible, offer_kind)
    VALUES (v_src.company_id, 'selftest-088', 'selftest', v_src.contract_type, 'Aeroplane', 'mechanic',
      true, 'B1.1', 'EASA', ARRAY['UK_CAA', 'CASA'], v_src.location_country, v_src.location_country_code,
      0, 'draft', false, 'aircraft');
    v_ok := true;
    RAISE EXCEPTION USING ERRCODE = 'P0088', MESSAGE = 'deshacer control';
  EXCEPTION WHEN SQLSTATE 'P0088' THEN
    NULL;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION '088: la oferta de control (EASA B1.1 aceptando UK CAA y CASA) no se pudo escribir.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.offers WHERE title = 'selftest-088') THEN
    RAISE EXCEPTION '088: la autocomprobación dejó filas escritas.';
  END IF;

  RAISE NOTICE '088: accepted_authorities con CHECK y trigger; prohibidas rechazadas, control aceptado y deshecho.';
END $$;

NOTIFY pgrst, 'reload schema';
